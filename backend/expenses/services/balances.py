"""
Every number this module produces is derived by summing rows that already
exist in the database (ExpenseParticipant.share_amount, Expense paid_by,
Settlement) - nothing here is a separately-stored "balance" that could get
out of sync with the underlying expenses. That's deliberate: Rohan's
requirement was that every balance be traceable, and a cached/stored balance
field is exactly the kind of thing that drifts from reality.
"""
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from expenses.models import Expense, ExpenseParticipant, Settlement


@dataclass
class BalanceLine:
    """One contributing entry to a user's balance - either their side of an
    expense (paid vs owed) or a settlement. This is what renders under
    Rohan's balance number when he clicks it."""
    kind: str  # "paid", "owed", "settlement_out", "settlement_in"
    date: object
    description: str
    amount: Decimal
    expense_id: int | None = None
    settlement_id: int | None = None


def net_balance_for_group(group) -> dict[int, Decimal]:
    """
    balance[user] > 0  => the group owes this user money (they're a net creditor)
    balance[user] < 0  => this user owes the group money (they're a net debtor)

    Formula, per user:
        + amount they paid out on expenses they fronted
        - amount of their own share across all expenses they participated in
        + settlements where they were the payer (from_user) - paying off a
          debt moves their balance UP, toward zero or positive
        - settlements where they were the recipient (to_user) - receiving
          money moves their balance DOWN, toward zero
    """
    balances: dict[int, Decimal] = defaultdict(Decimal)

    for expense in Expense.objects.filter(group=group):
        balances[expense.paid_by_id] += expense.converted_inr_amount

    for participant in ExpenseParticipant.objects.filter(expense__group=group).select_related("expense"):
        if participant.user_id is not None:
            balances[participant.user_id] -= participant.share_amount
        # Guest shares (user_id is None) don't touch any group member's
        # balance directly - the guest isn't a member, so nobody in the
        # group owes/is-owed on their behalf. The payer already got full
        # credit for the whole expense.original_amount above; if that feels
        # wrong for a given guest expense, that's a per-expense judgment
        # call, not something the engine should guess at silently.

    for settlement in Settlement.objects.filter(group=group):
        balances[settlement.from_user_id] += settlement.amount
        balances[settlement.to_user_id] -= settlement.amount

    return dict(balances)


def balance_trail_for_user(group, user) -> list[BalanceLine]:
    """The literal list of rows that sum to this user's net balance. This
    function and net_balance_for_group must never diverge - if you change
    one you change both, and the tests in test_balances.py check that the
    trail always sums to the same number the summary returns."""
    lines: list[BalanceLine] = []

    for expense in Expense.objects.filter(group=group, paid_by=user):
        lines.append(BalanceLine("paid", expense.date, expense.title, expense.converted_inr_amount, expense_id=expense.id))

    for p in ExpenseParticipant.objects.filter(expense__group=group, user=user).select_related("expense"):
        lines.append(BalanceLine("owed", p.expense.date, p.expense.title, -p.share_amount, expense_id=p.expense_id))

    for s in Settlement.objects.filter(group=group, from_user=user):
        lines.append(BalanceLine("settlement_out", s.date, s.note or "Settlement", s.amount, settlement_id=s.id))

    for s in Settlement.objects.filter(group=group, to_user=user):
        lines.append(BalanceLine("settlement_in", s.date, s.note or "Settlement", -s.amount, settlement_id=s.id))

    lines.sort(key=lambda l: l.date)
    return lines


def simplify_debts(balances: dict[int, Decimal]) -> list[tuple[int, int, Decimal]]:
    """
    Aisha's requirement: 'one number per person, who pays whom, done.'

    This is the classic greedy debt-simplification algorithm: repeatedly
    match the biggest debtor with the biggest creditor, settle the smaller
    of the two amounts, repeat. It minimizes the number of transactions
    needed to zero everyone out - it does NOT preserve who-originally-owed-
    whom for a specific expense (that's what the trail is for). This
    function answers "how do we clear the board with the fewest transfers",
    not "who owes what for the pizza".
    """
    creditors = [(uid, amt) for uid, amt in balances.items() if amt > Decimal("0.01")]
    debtors = [(uid, -amt) for uid, amt in balances.items() if amt < Decimal("-0.01")]
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])

    transactions: list[tuple[int, int, Decimal]] = []
    i, j = 0, 0
    creditors = [list(c) for c in creditors]
    debtors = [list(d) for d in debtors]

    while i < len(debtors) and j < len(creditors):
        debtor_id, debt_amt = debtors[i]
        creditor_id, credit_amt = creditors[j]
        settle_amt = min(debt_amt, credit_amt)

        if settle_amt > Decimal("0.01"):
            transactions.append((debtor_id, creditor_id, settle_amt.quantize(Decimal("0.01"))))

        debtors[i][1] -= settle_amt
        creditors[j][1] -= settle_amt

        if debtors[i][1] <= Decimal("0.01"):
            i += 1
        if creditors[j][1] <= Decimal("0.01"):
            j += 1

    return transactions
