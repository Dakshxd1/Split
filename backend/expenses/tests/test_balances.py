from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from expenses.models import Expense, ExpenseParticipant, Group, Settlement
from expenses.services.balances import balance_trail_for_user, net_balance_for_group, simplify_debts

User = get_user_model()


class BalanceEngineTests(TestCase):
    def setUp(self):
        self.aisha = User.objects.create_user(username="aisha", password="x", display_name="Aisha")
        self.rohan = User.objects.create_user(username="rohan", password="x", display_name="Rohan")
        self.priya = User.objects.create_user(username="priya", password="x", display_name="Priya")
        self.group = Group.objects.create(name="Flat 3B", created_by=self.aisha)

    def _expense(self, paid_by, amount, title="Expense"):
        return Expense.objects.create(
            group=self.group, paid_by=paid_by, title=title, date="2026-03-01",
            currency="INR", original_amount=amount, exchange_rate_used=1,
            converted_inr_amount=amount, split_type="equal",
        )

    def test_simple_three_way_split_balances_to_zero_sum(self):
        # Aisha pays 300, split equally three ways. Aisha should be owed 200
        # (she's out 300, her own share is 100), Rohan and Priya owe 100 each.
        expense = self._expense(self.aisha, Decimal("300.00"), "Dinner")
        for user in [self.aisha, self.rohan, self.priya]:
            ExpenseParticipant.objects.create(expense=expense, user=user, share_amount=Decimal("100.00"))

        balances = net_balance_for_group(self.group)

        self.assertEqual(balances[self.aisha.id], Decimal("200.00"))
        self.assertEqual(balances[self.rohan.id], Decimal("-100.00"))
        self.assertEqual(balances[self.priya.id], Decimal("-100.00"))
        # Fundamental invariant: total balances across a group always net to
        # zero. Money isn't created or destroyed by the split.
        self.assertEqual(sum(balances.values()), Decimal("0.00"))

    def test_settlement_zeroes_out_a_simple_debt(self):
        expense = self._expense(self.aisha, Decimal("200.00"), "Groceries")
        ExpenseParticipant.objects.create(expense=expense, user=self.aisha, share_amount=Decimal("100.00"))
        ExpenseParticipant.objects.create(expense=expense, user=self.rohan, share_amount=Decimal("100.00"))

        # Rohan owes Aisha 100. He pays her back in full.
        Settlement.objects.create(
            group=self.group, from_user=self.rohan, to_user=self.aisha,
            amount=Decimal("100.00"), date="2026-03-05",
        )

        balances = net_balance_for_group(self.group)
        self.assertEqual(balances[self.rohan.id], Decimal("0.00"))
        self.assertEqual(balances[self.aisha.id], Decimal("0.00"))

    def test_audit_trail_sums_to_the_same_balance_the_summary_reports(self):
        """This is Rohan's exact requirement, tested directly: whatever
        the summary number is, the trail must add up to it."""
        e1 = self._expense(self.aisha, Decimal("300.00"), "Dinner")
        for user in [self.aisha, self.rohan, self.priya]:
            ExpenseParticipant.objects.create(expense=e1, user=user, share_amount=Decimal("100.00"))

        e2 = self._expense(self.rohan, Decimal("90.00"), "Wifi")
        for user in [self.aisha, self.rohan, self.priya]:
            ExpenseParticipant.objects.create(expense=e2, user=user, share_amount=Decimal("30.00"))

        Settlement.objects.create(
            group=self.group, from_user=self.rohan, to_user=self.aisha,
            amount=Decimal("20.00"), date="2026-03-06",
        )

        summary_balance = net_balance_for_group(self.group)[self.rohan.id]
        trail = balance_trail_for_user(self.group, self.rohan)
        trail_total = sum(line.amount for line in trail)

        self.assertEqual(summary_balance, trail_total)


class DebtSimplificationTests(TestCase):
    def setUp(self):
        self.a = User.objects.create_user(username="a", password="x")
        self.b = User.objects.create_user(username="b", password="x")
        self.c = User.objects.create_user(username="c", password="x")

    def test_minimizes_to_fewest_transactions(self):
        # a owes 100, b is owed 40, c is owed 60 -> should resolve in
        # exactly 2 transactions, not 3, and never route money through
        # someone who neither owes nor is owed.
        balances = {self.a.id: Decimal("-100.00"), self.b.id: Decimal("40.00"), self.c.id: Decimal("60.00")}
        txns = simplify_debts(balances)

        self.assertEqual(len(txns), 2)
        total_settled = sum(amt for _, _, amt in txns)
        self.assertEqual(total_settled, Decimal("100.00"))
        # every txn originates from the debtor
        self.assertTrue(all(frm == self.a.id for frm, _, _ in txns))

    def test_already_settled_group_produces_no_transactions(self):
        self.assertEqual(simplify_debts({self.a.id: Decimal("0.00"), self.b.id: Decimal("0.00")}), [])
