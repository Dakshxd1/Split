from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase

from expenses.models import Expense, Group, GroupMembership, ImportAnomaly, Settlement
from expenses.services.importer import ImportEngine

User = get_user_model()
FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "expenses_export.csv"


class ImporterRealDataTests(TestCase):
    """
    Runs the importer against the actual assignment CSV. This is the test
    to run live if asked 'trace what happens to row X' - each test below
    points at a specific real row and asserts the exact outcome.
    """

    @classmethod
    def setUpTestData(cls):
        cls.aisha = User.objects.create_user(username="aisha", password="x", display_name="Aisha")
        cls.rohan = User.objects.create_user(username="rohan", password="x", display_name="Rohan")
        cls.priya = User.objects.create_user(username="priya", password="x", display_name="Priya")
        cls.meera = User.objects.create_user(username="meera", password="x", display_name="Meera")
        cls.dev = User.objects.create_user(username="dev", password="x", display_name="Dev")
        cls.sam = User.objects.create_user(username="sam", password="x", display_name="Sam")
        cls.group = Group.objects.create(name="Flat 3B", created_by=cls.aisha)

        # Membership history matching the real timeline: Aisha/Rohan/Priya
        # present throughout, Meera leaves end of March, Sam joins mid-April.
        # Dev is never a member (he's a trip guest, resolvable by name but
        # never active -> his own expenses as payer are fine, but as a
        # participant he'd fail membership check unless we give him rows too).
        GroupMembership.objects.create(group=cls.group, user=cls.aisha, joined_at="2026-02-01")
        GroupMembership.objects.create(group=cls.group, user=cls.rohan, joined_at="2026-02-01")
        GroupMembership.objects.create(group=cls.group, user=cls.priya, joined_at="2026-02-01")
        GroupMembership.objects.create(group=cls.group, user=cls.meera, joined_at="2026-02-01", left_at="2026-03-31")
        GroupMembership.objects.create(group=cls.group, user=cls.sam, joined_at="2026-04-14")
        # Dev is a trip guest, not a flatmate - active for trip week only,
        # modeled as a short membership window rather than a per-expense
        # guest, since he appears as a participant on 6 different rows.
        GroupMembership.objects.create(group=cls.group, user=cls.dev, joined_at="2026-03-08", left_at="2026-03-13")

        cls.batch = ImportEngine(cls.group, cls.aisha).run(FIXTURE.read_text())

    def anomalies_for_row(self, row_number):
        return list(ImportAnomaly.objects.filter(import_batch=self.batch, row_number=row_number))

    def test_february_rent_imports_cleanly(self):
        # Row 2: straightforward equal split, no issues.
        expense = Expense.objects.get(import_batch=self.batch, source_row=2)
        self.assertEqual(expense.title, "February rent")
        self.assertEqual(expense.participants.count(), 4)
        self.assertEqual(self.anomalies_for_row(2), [])

    def test_marina_bites_duplicate_is_flagged_not_guessed(self):
        # Rows 5 & 6: same dinner logged twice, identical amount.
        anomalies = self.anomalies_for_row(6)
        self.assertEqual(len(anomalies), 1)
        self.assertEqual(anomalies[0].issue_type, "duplicate")
        self.assertEqual(anomalies[0].status, "pending")
        # Neither row becomes an Expense until a human resolves it.
        self.assertFalse(Expense.objects.filter(import_batch=self.batch, source_row=6).exists())

    def test_settlement_never_becomes_an_expense(self):
        # Row 14: "Rohan paid Aisha back" - flagged, held, not an Expense.
        anomalies = self.anomalies_for_row(14)
        self.assertTrue(any(a.issue_type == "settlement_as_expense" for a in anomalies))
        self.assertFalse(Expense.objects.filter(import_batch=self.batch, source_row=14).exists())
        self.assertFalse(Settlement.objects.filter(import_batch=self.batch, source_row=14).exists())

    def test_pizza_friday_bad_percentages_blocked(self):
        # Row 15: 30+30+30+20 = 110%. Must not import with a guessed split.
        anomalies = self.anomalies_for_row(15)
        self.assertTrue(any(a.issue_type == "split_percentage_invalid" for a in anomalies))
        self.assertFalse(Expense.objects.filter(import_batch=self.batch, source_row=15).exists())

    def test_corrupted_2014_date_blocked(self):
        # Airport cab row - year is 2014, clearly meant 2026.
        row = next(
            a for a in ImportAnomaly.objects.filter(import_batch=self.batch)
            if a.raw_data.get("description") == "Airport cab"
        )
        self.assertEqual(row.issue_type, "invalid_date")
        self.assertFalse(Expense.objects.filter(title="Airport cab").exists())

    def test_missing_currency_blocked_not_defaulted_to_inr(self):
        row = next(
            a for a in ImportAnomaly.objects.filter(import_batch=self.batch)
            if "forgot to set currency" in (a.raw_data.get("notes") or "")
        )
        self.assertEqual(row.issue_type, "missing_currency")

    def test_meera_still_listed_after_moveout_gets_auto_excluded_and_logged(self):
        # April 2 groceries: Meera still in split_with, but her membership
        # ended March 31. She should be excluded, and it should be visible.
        row = next(
            a for a in ImportAnomaly.objects.filter(import_batch=self.batch)
            if "Meera still in the group list" in (a.raw_data.get("notes") or "")
        )
        self.assertEqual(row.issue_type, "membership_mismatch")
        expense = Expense.objects.get(import_batch=self.batch, source_row=row.row_number)
        participant_ids = set(expense.participants.values_list("user_id", flat=True))
        self.assertNotIn(self.meera.id, participant_ids)

    def test_negative_refund_amount_imported_with_warning_not_blocked(self):
        row = next(
            a for a in ImportAnomaly.objects.filter(import_batch=self.batch)
            if "slot got cancelled" in (a.raw_data.get("notes") or "")
        )
        self.assertEqual(row.issue_type, "negative_amount")
        self.assertEqual(row.severity, "warning")
        self.assertTrue(Expense.objects.filter(import_batch=self.batch, source_row=row.row_number).exists())

    def test_report_totals_are_consistent(self):
        self.batch.refresh_from_db()
        clean_imports = Expense.objects.filter(import_batch=self.batch).count()
        self.assertEqual(self.batch.imported_rows, clean_imports)
        self.assertGreaterEqual(ImportAnomaly.objects.filter(import_batch=self.batch).count(), 12)
