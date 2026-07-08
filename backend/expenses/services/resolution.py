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
                                  (e.g. corrected_date, corrected_currency)
      - "keep_both"            : duplicate-only - import this row anyway
                                  alongside the one it duplicates
      - "convert_to_settlement": settlement-as-expense rows only
    """
    if anomaly.status != "pending":
        raise ResolutionError(f"anomaly {anomaly.id} already resolved ({anomaly.status})")

    handlers = {
        "skip": _handle_skip,
        "import_as_is": _handle_import_as_is,
        "import_with_correction": _handle_import_with_correction,
        "keep_both": _handle_keep_both,
        "convert_to_settlement": _handle_convert_to_settlement,
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
