from decimal import Decimal

from django.test import TestCase

from expenses.services.splitting import ShareInput, SplitError, compute_split


class EqualSplitTests(TestCase):
    def test_divides_evenly(self):
        shares = compute_split("equal", Decimal("100.00"), [
            ShareInput("1", None), ShareInput("2", None), ShareInput("3", None), ShareInput("4", None),
        ])
        self.assertEqual([s.share_amount for s in shares], [Decimal("25.00")] * 4)

    def test_remainder_goes_to_first_participants_in_order(self):
        # 100 / 3 = 33.33 with 0.01 left over -> first participant gets it.
        shares = compute_split("equal", Decimal("100.00"), [
            ShareInput("aisha", None), ShareInput("rohan", None), ShareInput("priya", None),
        ])
        amounts = {s.identifier: s.share_amount for s in shares}
        self.assertEqual(amounts["aisha"], Decimal("33.34"))
        self.assertEqual(amounts["rohan"], Decimal("33.33"))
        self.assertEqual(amounts["priya"], Decimal("33.33"))
        self.assertEqual(sum(amounts.values()), Decimal("100.00"))

    def test_real_cylinder_refill_amount_899_995_after_rounding_to_2dp(self):
        # From the actual CSV: 899.995 gets rounded to 900.00 before it ever
        # reaches the splitter (that rounding happens in the importer, not
        # here) - this test documents that the splitter itself only ever
        # sees clean 2dp amounts.
        shares = compute_split("equal", Decimal("900.00"), [
            ShareInput(str(i), None) for i in range(4)
        ])
        self.assertEqual(sum(s.share_amount for s in shares), Decimal("900.00"))


class ExactAndUnequalSplitTests(TestCase):
    def test_unequal_split_matches_aisha_birthday_cake_row(self):
        # Real CSV row: 'Rohan 700; Priya 400; Meera 400' on a 1500 cake,
        # Aisha excluded (her own birthday).
        shares = compute_split("unequal", Decimal("1500.00"), [
            ShareInput("rohan", Decimal("700")),
            ShareInput("priya", Decimal("400")),
            ShareInput("meera", Decimal("400")),
        ])
        total = sum(s.share_amount for s in shares)
        self.assertEqual(total, Decimal("1500.00"))

    def test_rejects_amounts_that_dont_sum_to_total(self):
        with self.assertRaises(SplitError):
            compute_split("exact", Decimal("1000.00"), [
                ShareInput("a", Decimal("400")), ShareInput("b", Decimal("400")),
            ])


class PercentageSplitTests(TestCase):
    def test_rejects_percentages_not_summing_to_100(self):
        # Real CSV row: Pizza Friday, 30+30+30+20 = 110.
        with self.assertRaises(SplitError):
            compute_split("percentage", Decimal("1440.00"), [
                ShareInput("aisha", Decimal("30")),
                ShareInput("rohan", Decimal("30")),
                ShareInput("priya", Decimal("30")),
                ShareInput("meera", Decimal("20")),
            ])

    def test_valid_percentage_split_sums_to_total(self):
        shares = compute_split("percentage", Decimal("2200.00"), [
            ShareInput("aisha", Decimal("30")),
            ShareInput("rohan", Decimal("30")),
            ShareInput("priya", Decimal("30")),
            ShareInput("meera", Decimal("10")),
        ])
        self.assertEqual(sum(s.share_amount for s in shares), Decimal("2200.00"))


class ShareSplitTests(TestCase):
    def test_scooter_rentals_weighted_split(self):
        # Real CSV row: Aisha 1; Rohan 2; Priya 1; Dev 2 on a 3600 total.
        shares = compute_split("share", Decimal("3600.00"), [
            ShareInput("aisha", Decimal("1")),
            ShareInput("rohan", Decimal("2")),
            ShareInput("priya", Decimal("1")),
            ShareInput("dev", Decimal("2")),
        ])
        amounts = {s.identifier: s.share_amount for s in shares}
        self.assertEqual(amounts["rohan"], amounts["dev"])
        self.assertEqual(amounts["aisha"], amounts["priya"])
        self.assertEqual(sum(amounts.values()), Decimal("3600.00"))
