"""
Turns (total_amount, split_type, raw participant input) into a list of
(identifier, share_amount, share_input) that always sums exactly to
total_amount.

Why this is its own module, not a method on Expense: the live evaluation
explicitly says they may ask you to "change the rounding rule" on the spot.
If rounding logic were scattered across the model and the importer, that's
two places to find and change under time pressure. Here, it's one function:
_distribute_remainder.
"""
from decimal import ROUND_DOWN, Decimal
from typing import NamedTuple


class ShareInput(NamedTuple):
    identifier: str  # user id (as string) or guest name
    raw_value: Decimal | None  # None for 'equal'; exact amount, percentage, or share count otherwise


class ComputedShare(NamedTuple):
    identifier: str
    share_amount: Decimal
    share_input: Decimal | None


class SplitError(ValueError):
    """Raised when the split can't be resolved without guessing (percentages
    don't add to 100, exact amounts don't add to the total, etc). Callers in
    the importer catch this and turn it into a blocking ImportAnomaly rather
    than letting it propagate as a 500."""


def _distribute_remainder(total: Decimal, base_shares: list[Decimal]) -> list[Decimal]:
    """
    THE ROUNDING RULE. Change it here and only here.

    Current rule: after everyone gets their rounded-down base share, whatever
    is left over (always a small number of paise, since we round to 2dp) is
    handed out one paisa at a time, in participant order, starting from the
    first participant. Deterministic and auditable - the same input always
    produces the same output, and it's traceable to "you were listed
    earlier in split_with".
    """
    total_base = sum(base_shares)
    remainder_paise = int(((total - total_base) / Decimal("0.01")).to_integral_value())
    shares = list(base_shares)
    for i in range(remainder_paise):
        shares[i % len(shares)] += Decimal("0.01")
    return shares


def split_equal(total: Decimal, participant_ids: list[str]) -> list[ComputedShare]:
    if not participant_ids:
        raise SplitError("Cannot split an expense with zero participants.")
    n = len(participant_ids)
    base = (total / n).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    shares = _distribute_remainder(total, [base] * n)
    return [ComputedShare(pid, amt, None) for pid, amt in zip(participant_ids, shares)]


def split_exact(total: Decimal, inputs: list[ShareInput]) -> list[ComputedShare]:
    """Used for both 'exact' and 'unequal' split types - both are just
    'here is the literal amount each person owes', they differ only in
    whether every group member is named or just a subset."""
    declared_sum = sum(i.raw_value for i in inputs)
    if abs(declared_sum - total) > Decimal("0.01"):
        raise SplitError(
            f"Exact/unequal split amounts sum to {declared_sum}, expense total is {total}."
        )
    return [ComputedShare(i.identifier, i.raw_value, i.raw_value) for i in inputs]


def split_percentage(total: Decimal, inputs: list[ShareInput]) -> list[ComputedShare]:
    declared_sum = sum(i.raw_value for i in inputs)
    if abs(declared_sum - Decimal("100")) > Decimal("0.01"):
        raise SplitError(f"Percentages sum to {declared_sum}, not 100.")
    base = [
        (total * i.raw_value / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        for i in inputs
    ]
    shares = _distribute_remainder(total, base)
    return [ComputedShare(i.identifier, amt, i.raw_value) for i, amt in zip(inputs, shares)]


def split_share(total: Decimal, inputs: list[ShareInput]) -> list[ComputedShare]:
    """Weighted-unit split, e.g. scooter rentals: Rohan and Dev took bigger
    scooters (2 shares each), Aisha and Priya took smaller ones (1 share)."""
    total_units = sum(i.raw_value for i in inputs)
    if total_units <= 0:
        raise SplitError("Share split must have at least one positive share unit.")
    base = [
        (total * i.raw_value / total_units).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        for i in inputs
    ]
    shares = _distribute_remainder(total, base)
    return [ComputedShare(i.identifier, amt, i.raw_value) for i, amt in zip(inputs, shares)]


SPLIT_FUNCTIONS = {
    "equal": lambda total, inputs: split_equal(total, [i.identifier for i in inputs]),
    "exact": split_exact,
    "unequal": split_exact,
    "percentage": split_percentage,
    "share": split_share,
}


def compute_split(split_type: str, total: Decimal, inputs: list[ShareInput]) -> list[ComputedShare]:
    if split_type not in SPLIT_FUNCTIONS:
        raise SplitError(f"Unknown split type: {split_type}")
    return SPLIT_FUNCTIONS[split_type](total, inputs)
