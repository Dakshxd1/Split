# Decision Log

Each entry: the decision, options I considered, why I picked what I picked.
I'll add to this file as the build progresses — it should read like a paper trail,
not a summary written after the fact.

---

## 1. Membership is the source of truth, not the CSV's `split_with` column

**Problem:** The CSV sometimes lists people in `split_with` who weren't active
members on that date (e.g. Meera still listed on an April 2 groceries row,
after she moved out March 31).

**Options considered:**
- Trust the CSV row exactly as written — simplest, but wrong per Sam's and
  Meera's stated expectations (a person shouldn't be charged for expenses
  outside their tenancy).
- Cross-check every participant against `GroupMembership.joined_at /
  left_at` for that expense's date, and silently filter out anyone who
  wasn't active — accurate, but silent correction violates the "no silent
  guess" rule.
- Cross-check against membership **and** log it as a surfaced anomaly, even
  though the correction itself is applied automatically.

**Decision:** Third option. Membership dates are the one thing in this
system I trust more than the CSV, because they're something the group
would actually agree on and can be verified independently (move-in/move-out
is a real-world fact, not something written into a spreadsheet cell by
whoever was doing the export that week). The correction is applied
automatically because leaving it manual for every affected row would make
the import unusable at scale — but every instance is still written to the
import report so nothing is invisible.

---

## 2. Duplicate expenses require an explicit human choice — no default suggestion

**Problem:** Feb 8 "Dinner at Marina Bites" is logged twice, identical
amount. March 11 "Thalassa dinner" is logged twice by two different people
with two different amounts (2400 vs 2450).

**Decision:** The importer never guesses which row is correct, and does not
even bias the reviewer toward "first occurrence" or "highest amount" —
both rows are shown side by side with full details, and the person
resolving the anomaly (Meera's requirement: everyone can see and approve
deletions) must explicitly pick keep-A / keep-B / keep-both. This is
deliberately more friction than a "smart default" would be, but a same-
amount duplicate and a conflicting-amount duplicate are different failure
modes under the hood (one is probably a copy-paste, the other is a real
disagreement about what was spent) and collapsing them into one auto-rule
would hide that difference.

---

## 3. Non-member guests (Kabir) get added as temporary participants, not folded into existing members

**Problem:** Parasailing (Mar 11) includes "Dev's friend Kabir," who isn't
a group member.

**Options considered:**
- Silently exclude Kabir and re-split his share across the four real
  members — cleaner data model, but changes what everyone actually paid
  without anyone agreeing to it.
- Add Kabir as a full group member — wrong, he was never actually living
  there and shouldn't show up in ongoing balances.

**Decision:** A guest participant, scoped to a single expense, not a
`GroupMembership` row. He can be a payer or a split participant on that one
expense without polluting the group's membership history or ongoing balance
calculations.

---

## 4. USD conversion uses a fixed documented rate, not a live API

**Problem:** Several trip expenses are in USD with no exchange rate given.

**Decision:** Use a fixed rate of ₹83/USD for the trip dates (early-mid
March 2026), applied consistently across all USD rows and stored per-
expense as `exchange_rate_used` alongside the original USD amount — never
overwriting the original. This is flagged in the import report as an
assumption, not presented as fact, because a live historical-rate API is
overkill for a handful of same-week transactions and adds an external
dependency I'd have to justify defending live. If asked to defend this: the
rate is wrong by at most a percent or two either way for a one-week window,
and every converted value is traceable back to its original USD amount so
the assumption can be corrected later without re-importing.

---

## 5. Settlement-as-expense detection

**Problem:** "Rohan paid Aisha back" (₹5000, `split_type` blank, single
person in `split_with`) is a repayment, not a shared cost.

**Decision:** Detected by the combination of null `split_type` + exactly
one person in `split_with` + payer ≠ that person. Held for approval, and on
approval becomes a `Settlement` row, never an `Expense` row — Aisha's
"just tell me who owes whom" number should never be polluted by money that
already changed hands outside the split logic.

---

## 6. Rounding rule for splits that don't divide evenly

**Problem:** ₹100 split three ways doesn't divide evenly into paise.

**Decision:** Round each base share down to 2 decimal places, then hand out
the leftover paise one at a time, in participant order, starting from the
first person in the split. Isolated in a single function
(`_distribute_remainder` in `services/splitting.py`) specifically because
this is the kind of rule that gets asked to change on the spot — "round
up instead," "give the remainder to the payer," "give it to whoever's
listed last" are all one-line changes to that function, not a refactor.
