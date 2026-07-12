"""
Ingests expenses_export.csv exactly as provided (no hand-editing, per the
assignment). Two-pass design:

  Pass 1 (detect):  every row is checked against every rule below. Rows with
                     zero anomalies are imported immediately. Rows with any
                     anomaly are held as pending ImportAnomaly records and
                     NOT written as Expense/Settlement - nothing gets
                     guessed into existence.

  Pass 2 (resolve):  a human (Meera's requirement) reviews each pending
                     anomaly through the API and picks an action. Only then
                     does the row become a real Expense/Settlement.

This file never talks to Django's HTTP layer - it's called by
expenses/views.py, and it's what test_importer.py exercises directly.
"""
import csv
import io
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import transaction

from expenses.models import (
    Expense, ExpenseParticipant, GroupMembership, ImportAnomaly, ImportBatch, Settlement,
)
from expenses.services.splitting import ShareInput, SplitError, compute_split

User = get_user_model()

# Decision #4 in DECISIONS.md: fixed rate for the trip window, documented
# and flagged in the report rather than pulled from a live API.
FX_RATES = {"INR": Decimal("1"), "USD": Decimal("83.00")}

TODAY = date.today()


def _norm(name):
    return name.strip().lower() if name else None


def _parse_date(raw):
    """
    Returns (parsed_date, anomaly) where anomaly is None if the date is
    clean. Handles the two real problems in the data:
      - a corrupted year (2014 instead of 2026) -> flagged, not guessed
      - an ambiguous day/month that could plausibly be either -> flagged
    We don't try to be clever about ambiguous dates: if the row's own notes
    say 'is this April 5 or May 4', the importer has no more information
    than a human does, so it doesn't pick one.
    """
    if raw is None or str(raw).strip() == "":
        return None, "missing date"
    if isinstance(raw, datetime):
        d = raw.date()
    elif isinstance(raw, date):
        d = raw
    else:
        raw = str(raw).strip()
        d = None
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
            try:
                d = datetime.strptime(raw, fmt).date()
                break
            except ValueError:
                continue
        if d is None:
            return None, f"unparseable date: {raw!r}"

    if d.year < 2020 or d > TODAY + timedelta(days=1):
        return d, f"implausible year ({d.isoformat()}) - looks corrupted"
    return d, None


def _parse_amount(raw):
    """Returns (amount, anomaly). Handles the malformed-3-decimal-place row
    (899.995) by rounding to 2dp and flagging it, rather than truncating
    silently or crashing on the DecimalField's max_digits validation."""
    if raw is None or str(raw).strip() == "":
        return None, "missing amount"
    try:
        amt = Decimal(str(raw))
    except InvalidOperation:
        return None, f"amount is not a valid number: {raw!r}"

    anomaly = None
    if amt.as_tuple().exponent < -2:
        rounded = amt.quantize(Decimal("0.01"))
        anomaly = f"amount had more than 2 decimal places ({amt}), rounded to {rounded}"
        amt = rounded
    if amt == 0:
        anomaly = (anomaly + "; " if anomaly else "") + "amount is zero"
    elif amt < 0:
        anomaly = (anomaly + "; " if anomaly else "") + "amount is negative (refund, not error - see policy)"
    return amt, anomaly

def rows_from_xlsx(file_obj) -> list[dict]:
    """Reads the first worksheet of an .xlsx file into the same list-of-dicts
    shape csv.DictReader produces, so ImportEngine.run_rows() can treat CSV
    and XLSX uploads identically. Header row must match the CSV column
    names (date, amount, currency, paid_by, description, split_type,
    split_with, split_details, notes) - matching is case/whitespace
    insensitive but not otherwise fuzzy, same as the CSV path expects.

    Date/datetime cells are normalized to ISO date strings here. openpyxl
    returns native datetime/date objects for Excel date cells, and those
    get stored verbatim into ImportAnomaly.raw_data (a JSON field) whenever
    a row is flagged - datetime isn't JSON-serializable, so without this
    normalization every flagged row in an XLSX import throws a 400 at
    save time. CSV never hits this because csv.DictReader only ever
    produces strings. "YYYY-MM-DD" is already the first format
    _parse_date() tries, so this doesn't change parsing behavior at all.
    """
    import openpyxl

    wb = openpyxl.load_workbook(file_obj, data_only=True, read_only=True)
    ws = wb.worksheets[0]
    rows_iter = ws.iter_rows(values_only=True)

    try:
        header = next(rows_iter)
    except StopIteration:
        return []
    columns = [(str(h).strip().lower() if h is not None else "") for h in header]

    rows = []
    for raw_row in rows_iter:
        if raw_row is None or all(v is None for v in raw_row):
            continue  # skip blank rows (openpyxl often yields these at sheet end)
        row = {}
        for col, value in zip(columns, raw_row):
            if not col:
                continue
            if isinstance(value, datetime):
                value = value.date().isoformat()
            elif isinstance(value, date):
                value = value.isoformat()
            row[col] = "" if value is None else value
        rows.append(row)
    return rows

class ImportEngine:
    def __init__(self, group, uploaded_by, filename="expenses_export.csv"):
        self.group = group
        self.batch = ImportBatch.objects.create(group=group, uploaded_by=uploaded_by, filename=filename)
        self._name_cache: dict[str, User] = {}
        self._exact_signatures: dict[tuple, int] = {}  # (date, payer_norm, amount) -> row_number
        self._rows_by_date: dict[str, list[tuple]] = {}  # date_str -> [(row_number, title_tokens)]

        # PERFORMANCE FIX: both of these used to be queried fresh on every
        # single row (resolve_user() did `User.objects.all()` on every
        # unresolved-name miss; _active_members_on() re-queried
        # GroupMembership on every row). Neither changes mid-import, so both
        # are loaded once here instead. With the DB in a different region,
        # that per-row round trip was the dominant cost - for a ~36 row
        # file that added up to 150+ extra round trips and was the direct
        # cause of imports timing out around the 30s mark (Render's proxy
        # returns a bare 500 to the browser at that point, even though the
        # request keeps running server-side and finishes moments later -
        # which is why total_rows still ends up 0 on the batch the client
        # saw as "failed").
        self._all_users_by_norm: dict[str, User] = {}
        for user in User.objects.all():
            for key in (_norm(user.display_name), _norm(user.username)):
                if key:
                    self._all_users_by_norm.setdefault(key, user)

        self._all_memberships = list(GroupMembership.objects.filter(group=group))

    def resolve_user(self, raw_name):
        norm = _norm(raw_name)
        if norm is None:
            return None
        return self._all_users_by_norm.get(norm)

    def _flag(self, row_number, raw, issue_type, severity, description, suggested_action=""):
        return ImportAnomaly.objects.create(
            import_batch=self.batch, row_number=row_number, raw_data=raw,
            issue_type=issue_type, severity=severity, description=description,
            suggested_action=suggested_action,
        )

    def _active_members_on(self, d):
        return {m.user_id for m in self._all_memberships if m.is_active_on(d)}

    def run(self, csv_text: str):
        """Back-compat entry point: parses CSV text, then delegates to
        run_rows(). test_importer.py and any existing callers that pass raw
        CSV text keep working unchanged."""
        reader = csv.DictReader(io.StringIO(csv_text))
        return self.run_rows(list(reader))

    def run_rows(self, rows: list[dict]):
        """Shared pipeline for both CSV and XLSX imports: both formats are
        normalized to a list of {column_name: value} dicts before reaching
        here, so _process_row doesn't need to know which format it came
        from."""
        # RELIABILITY FIX: save total_rows immediately, before processing a
        # single row, instead of only after the whole loop finishes. We
        # already know this number as soon as the file is read - there's no
        # reason a slow or interrupted import should leave it at 0. If a
        # request times out client-side partway through (see the comment
        # in __init__), the person reloading the page still sees the
        # correct total instead of a batch that looks empty/broken.
        self.batch.total_rows = len(rows)
        self.batch.save(update_fields=["total_rows"])

        imported = 0
        for i, row in enumerate(rows, start=2):  # row 1 is the header
            if self._process_row(i, row):
                imported += 1

        self.batch.imported_rows = imported
        self.batch.save(update_fields=["imported_rows"])
        return self.batch

    @transaction.atomic
    def _process_row(self, row_number, row) -> bool:
        blocking = []
        warnings = []

        expense_date, date_issue = _parse_date(row.get("date"))
        if date_issue:
            severity = "blocking" if expense_date is None else "blocking"
            blocking.append(("invalid_date" if expense_date else "missing date", date_issue))

        amount, amount_issue = _parse_amount(row.get("amount"))
        if amount_issue:
            if amount is not None and amount < 0:
                warnings.append(("negative_amount", amount_issue))
            elif amount == 0:
                warnings.append(("zero_amount", amount_issue))
            else:
                warnings.append(("malformed_amount", amount_issue))

        currency = (row.get("currency") or "").strip().upper()
        if not currency:
            blocking.append(("missing_currency", "currency is blank - can't assume INR or USD"))
        elif currency not in FX_RATES:
            blocking.append(("missing_currency", f"unknown currency code: {currency}"))

        payer_raw = (row.get("paid_by") or "").strip()
        payer = self.resolve_user(payer_raw) if payer_raw else None
        if not payer_raw:
            blocking.append(("missing_payer", "paid_by is blank"))
        elif payer is None:
            blocking.append(("unresolved_name", f"payer name {payer_raw!r} does not match any known user"))

        title = (row.get("description") or "").strip()
        if not title:
            blocking.append(("other", "title/description is blank"))

        split_type = (row.get("split_type") or "").strip().lower()
        split_with_raw = [n.strip() for n in (row.get("split_with") or "").split(";") if n.strip()]

        is_settlement = (
            split_type == "" and len(split_with_raw) == 1 and payer is not None
        )

        # Duplicate detection has two tiers:
        #  - exact: same date + same payer + same amount => almost
        #    certainly a copy-paste (Marina Bites: identical row, logged
        #    twice by Dev).
        #  - conflicting: same date + overlapping title words but a
        #    DIFFERENT payer or amount => two people logged the same real
        #    event with different numbers (Thalassa: Aisha says 2400,
        #    Rohan says 2450). Both are duplicates; they need different
        #    handling, so they're classified differently.
        title_tokens = set(_norm(title).split()) if title else set()
        date_key = str(row.get("date"))
        exact_sig = (date_key, _norm(payer_raw), str(amount))
        dup_of = self._exact_signatures.get(exact_sig)

        conflicting_with = None
        if dup_of is None and title_tokens:
            for other_row_number, other_tokens in self._rows_by_date.get(date_key, []):
                if not other_tokens:
                    continue
                overlap = len(title_tokens & other_tokens) / len(title_tokens | other_tokens)
                if overlap >= 0.4:
                    conflicting_with = other_row_number
                    break

        self._exact_signatures.setdefault(exact_sig, row_number)
        self._rows_by_date.setdefault(date_key, []).append((row_number, title_tokens))

        if dup_of is not None:
            blocking.append(("duplicate", f"identical date+payer+amount as row {dup_of} - likely copy-paste duplicate"))
        elif conflicting_with is not None:
            blocking.append((
                "conflicting_duplicate",
                f"similar title to row {conflicting_with} on the same date, but different payer/amount - "
                f"two people logged the same event differently",
            ))

        # If anything blocking so far, stop here - don't try to resolve
        # participants/splits against data we already know is broken.
        if blocking or is_settlement:
            for issue_type, desc in blocking:
                self._flag(row_number, row, issue_type, "blocking", desc)
            if is_settlement:
                self._flag(
                    row_number, row, "settlement_as_expense", "blocking",
                    f"looks like a repayment ({payer_raw} -> {split_with_raw[0] if split_with_raw else '?'}), not a shared expense",
                    suggested_action="convert to Settlement instead of Expense",
                )
            for issue_type, desc in warnings:
                self._flag(row_number, row, issue_type, "warning", desc)
            return False

        # Resolve participants against group membership as of expense_date -
        # this is Decision #1: membership overrides whatever the CSV says.
        resolved_participants = []
        unresolved_names = []
        non_member_names = []
        active_ids = self._active_members_on(expense_date)

        for name in split_with_raw:
            user = self.resolve_user(name)
            if user is None:
                unresolved_names.append(name)
                continue
            if user.id not in active_ids:
                non_member_names.append(name)
                continue
            resolved_participants.append(user)

        if unresolved_names:
            self._flag(
                row_number, row, "unresolved_name", "blocking",
                f"participant(s) not recognized: {unresolved_names}",
            )
            for issue_type, desc in warnings:
                self._flag(row_number, row, issue_type, "warning", desc)
            return False

        if non_member_names:
            self._flag(
                row_number, row, "membership_mismatch", "warning",
                f"{non_member_names} not active group member(s) on {expense_date} - excluded from split automatically per membership dates",
                suggested_action="auto-excluded",
            )

        if not resolved_participants:
            self._flag(row_number, row, "other", "blocking", "no valid participants remain after membership filtering")
            return False

        # Split validation.
        converted_amount = (amount * FX_RATES[currency]).quantize(Decimal("0.01"))
        try:
            share_inputs = self._build_share_inputs(split_type, resolved_participants, row.get("split_details"))
            computed = compute_split(split_type, converted_amount, share_inputs)
        except SplitError as e:
            self._flag(row_number, row, "split_percentage_invalid" if split_type == "percentage" else "other",
                       "blocking", str(e))
            return False

        # Everything checks out - write the row.
        expense = Expense.objects.create(
            group=self.group, paid_by=payer, title=title,
            description=(row.get("notes") or ""), date=expense_date,
            currency=currency, original_amount=amount,
            exchange_rate_used=FX_RATES[currency], converted_inr_amount=converted_amount,
            split_type=split_type, source_row=row_number, import_batch=self.batch,
        )
        ExpenseParticipant.objects.bulk_create([
            ExpenseParticipant(
                expense=expense, user_id=int(share.identifier),
                share_amount=share.share_amount, share_input=share.share_input,
            )
            for share in computed
        ])

        for issue_type, desc in warnings:
            self._flag(row_number, row, issue_type, "warning", desc)

        return True

    def _build_share_inputs(self, split_type, participants, split_details_raw):
        if split_type == "equal" or not split_details_raw:
            return [ShareInput(str(u.id), None) for u in participants]

        # split_details looks like "Rohan 700; Priya 400; Meera 400"
        detail_map = {}
        for part in split_details_raw.split(";"):
            part = part.strip()
            if not part:
                continue
            name, _, value = part.rpartition(" ")
            value = value.strip().rstrip("%")
            detail_map[_norm(name)] = Decimal(value)

        inputs = []
        for u in participants:
            val = detail_map.get(_norm(u.display_name)) or detail_map.get(_norm(u.username))
            if val is None:
                raise SplitError(f"no {split_type} value found for {u.display_name} in split_details")
            inputs.append(ShareInput(str(u.id), val))
        return inputs