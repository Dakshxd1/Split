"""
Turns a human's decision on a pending ImportAnomaly into an actual database
write. Nothing in importer.py ever calls this automatically - it's only
reachable through the API's resolve-anomaly endpoint, which requires an
authenticated request from a group member.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone

from expenses.models import Expense, ExpenseParticipant, ImportAnomaly, Settlement
from expenses.services.importer import FX_RATES
from expenses.services.splitting import ShareInput, compute_split

User = get_user_model()


class ResolutionError(ValueError):
    pass


def resolve_anomaly(anomaly: ImportAnomaly, action: str, resolved_by, **kwargs) -> None:
    """
    action is one of:
      - "skip"                 : row is permanently not imported
      - "import_as_is"         : import despite the warning (only valid for
                                  severity="warning" rows - blocking rows
                                  need a correction, not a shrug)
      - "import_with_correction": kwargs must supply the corrected field(s)
                                  under `corrections` (e.g. corrections=
                                  {"currency": "USD"} or {"date": "2026-03-01"}).
                                  Used for missing_currency / invalid_date.
      - "keep_both"            : duplicate-only - import this row anyway
                                  alongside the one it duplicates
      - "convert_to_settlement": settlement-as-expense rows only
      - "reassign_names"       : unresolved_name only - kwargs supply
                                  `name_map` = {original CSV name: user_id},
                                  covering both an unresolved payer and any
                                  number of unresolved participant names.
      - "normalize_split"      : split_percentage_invalid only - rescales
                                  the declared percentages proportionally so
                                  they sum to exactly 100, then imports.
    """
    if anomaly.status != "pending":
        raise ResolutionError(f"anomaly {anomaly.id} already resolved ({anomaly.status})")

    handlers = {
        "skip": _handle_skip,
        "import_as_is": _handle_import_as_is,
        "import_with_correction": _handle_import_with_correction,
        "keep_both": _handle_keep_both,
        "convert_to_settlement": _handle_convert_to_settlement,
        "reassign_names": _handle_reassign_names,
        "normalize_split": _handle_normalize_split,
    }
    if action not in handlers:
        raise ResolutionError(f"unknown action: {action}")

    handlers[action](anomaly, **kwargs)

    anomaly.status = "rejected" if action == "skip" else "resolved"
    anomaly.chosen_action = action
    anomaly.resolved_by = resolved_by
    anomaly.resolved_at = timezone.now()
    anomaly.save()


def _handle_skip(anomaly, **_):
    pass  # row simply never becomes an Expense/Settlement; nothing to write


def _handle_import_as_is(anomaly, **_):
    if anomaly.severity == "blocking":
        raise ResolutionError("blocking anomalies need a correction, not import_as_is")
    _write_expense_from_row(anomaly)


def _handle_import_with_correction(anomaly, corrections: dict, **_):
    row = dict(anomaly.raw_data)
    row.update(corrections)
    _write_expense_from_row(anomaly, row_override=row)


def _handle_keep_both(anomaly, **_):
    _write_expense_from_row(anomaly)


def _handle_convert_to_settlement(anomaly, from_user_id=None, to_user_id=None, **_):
    row = anomaly.raw_data
    payer = User.objects.get(id=from_user_id) if from_user_id else None
    recipient = User.objects.get(id=to_user_id) if to_user_id else None
    if payer is None or recipient is None:
        raise ResolutionError("convert_to_settlement requires from_user_id and to_user_id")

    Settlement.objects.create(
        group=anomaly.import_batch.group, from_user=payer, to_user=recipient,
        amount=Decimal(str(row["amount"])), date=row["date"],
        note=row.get("notes") or row.get("description") or "",
        source_row=anomaly.row_number, import_batch=anomaly.import_batch,
    )


def _handle_reassign_names(anomaly, name_map: dict = None, **_):
    """unresolved_name fix: name_map maps the exact string that appeared in
    the CSV (either the whole paid_by field, or one token inside the
    semicolon-separated split_with field) to the user_id the human picked
    from the member dropdown. Handles both an unresolved payer (row 11,
    'Priya S') and unresolved participants (row 23, "Dev's friend Kabir")
    with the same payload shape, since a row can in principle have both."""
    if not name_map:
        raise ResolutionError("reassign_names requires a non-empty name_map")

    row = dict(anomaly.raw_data)

    payer_raw = (row.get("paid_by") or "").strip()
    if payer_raw in name_map:
        user = User.objects.get(id=name_map[payer_raw])
        row["paid_by"] = user.display_name

    split_with_raw = row.get("split_with") or ""
    tokens = [t.strip() for t in split_with_raw.split(";") if t.strip()]
    if tokens:
        new_tokens = []
        for t in tokens:
            if t in name_map:
                user = User.objects.get(id=name_map[t])
                new_tokens.append(user.display_name)
            else:
                new_tokens.append(t)
        row["split_with"] = ";".join(new_tokens)

    _write_expense_from_row(anomaly, row_override=row)


def _handle_normalize_split(anomaly, **_):
    """split_percentage_invalid fix: rescales each declared percentage
    proportionally so they sum to exactly 100 (e.g. 30/30/30/20 = 110 ->
    27.27/27.27/27.27/18.18), then re-runs the normal split computation.
    Only valid for split_type == 'percentage' rows, which is the only
    split type that produces this anomaly."""
    row = dict(anomaly.raw_data)
    split_type = (row.get("split_type") or "").strip().lower()
    if split_type != "percentage":
        raise ResolutionError(f"normalize_split only applies to percentage splits, got {split_type!r}")

    raw_details = row.get("split_details") or ""
    parsed = []
    for part in raw_details.split(";"):
        part = part.strip()
        if not part:
            continue
        name, _, value = part.rpartition(" ")
        parsed.append((name.strip(), Decimal(value.strip().rstrip("%"))))

    if not parsed:
        raise ResolutionError("no split_details found to normalize")

    total_pct = sum(v for _, v in parsed)
    if total_pct <= 0:
        raise ResolutionError(f"cannot normalize a split totalling {total_pct}%")

    normalized = [(name, (v / total_pct * Decimal("100"))) for name, v in parsed]
    row["split_details"] = "; ".join(f"{name} {v.quantize(Decimal('0.01'))}%" for name, v in normalized)

    _write_expense_from_row(anomaly, row_override=row)


def _write_expense_from_row(anomaly, row_override=None):
    """Re-runs the same participant-resolution and split logic the importer
    uses for clean rows, but on a single corrected row. Kept separate from
    ImportEngine to avoid re-triggering duplicate/anomaly detection on a row
    a human already looked at."""
    from expenses.services.importer import ImportEngine  # avoid circular import at module load

    row = row_override or anomaly.raw_data
    group = anomaly.import_batch.group
    engine = ImportEngine(group, anomaly.resolved_by, filename="(manual resolution)")
    engine.batch = anomaly.import_batch  # write into the existing batch, don't create a new one

    payer = engine.resolve_user(row.get("paid_by"))
    if payer is None:
        raise ResolutionError(f"payer {row.get('paid_by')!r} still cannot be resolved")

    split_type = (row.get("split_type") or "equal").strip().lower()
    split_with = [n.strip() for n in (row.get("split_with") or "").split(";") if n.strip()]
    currency = (row.get("currency") or "INR").strip().upper()
    amount = Decimal(str(row["amount"]))

    active_ids = engine._active_members_on(row["date"] if hasattr(row["date"], "year") else _parse_iso(row["date"]))
    participants = [u for name in split_with if (u := engine.resolve_user(name)) and u.id in active_ids]
    if not participants:
        raise ResolutionError("no valid participants after membership filtering")

    converted = (amount * FX_RATES.get(currency, Decimal("1"))).quantize(Decimal("0.01"))
    share_inputs = engine._build_share_inputs(split_type, participants, row.get("split_details"))
    computed = compute_split(split_type, converted, share_inputs)

    expense = Expense.objects.create(
        group=group, paid_by=payer, title=row.get("description", "").strip() or "(untitled)",
        description=row.get("notes") or "", date=row["date"] if hasattr(row["date"], "year") else _parse_iso(row["date"]),
        currency=currency, original_amount=amount, exchange_rate_used=FX_RATES.get(currency, Decimal("1")),
        converted_inr_amount=converted, split_type=split_type,
        source_row=anomaly.row_number, import_batch=anomaly.import_batch,
    )
    for share in computed:
        ExpenseParticipant.objects.create(
            expense=expense, user_id=int(share.identifier),
            share_amount=share.share_amount, share_input=share.share_input,
        )


def _parse_iso(raw):
    from datetime import datetime
    return datetime.strptime(str(raw), "%Y-%m-%d").date()