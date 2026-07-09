# AI Usage

## Tool

Claude (Anthropic), used conversationally as the primary development
collaborator throughout — architecture discussion, code generation, and live
debugging in the same session, with all code run and tested rather than
taken on faith.

## Working approach

Rather than a single prompt that generated the whole app, this was built
decision-by-decision: I made the calls on ambiguous data (duplicate
handling, refund-vs-error, guest participants, FX rate source, rounding
rule), Claude wrote the code implementing each decision, and every piece was
run — migrations applied, tests executed, the dev server actually started
and hit with real HTTP requests against the real `expenses_export.csv` —
before moving to the next piece. Decisions are logged in `DECISIONS.md` as
they were made, not reconstructed afterward.

## Key prompts (paraphrased, in order)

1. "Read the actual assignment doc and the uploaded spreadsheet before
   building anything — don't generate a generic Splitwise clone."
2. For each ambiguous data problem (duplicates, negative amounts, guest
   participants, FX rate): "here are the options, what are the tradeoffs" →
   I picked, Claude logged the decision and reasoning.
3. "Build the balance engine first, as its own module, with tests against
   real rows from the CSV, before touching the API or frontend."
4. "The rounding rule needs to be isolated in one function — they said
   they might ask us to change it live."
5. "Run the importer against the real CSV file and show me what it actually
   detects, not what we assume it detects."
6. "Start the dev server and hit the real endpoints with curl — don't just
   trust that the code compiles."

## Cases where AI-generated code was wrong

### 1. Group creator's join date hardcoded to "today"

**Problem:** The first version of `GroupViewSet.perform_create` set the
creator's `GroupMembership.joined_at` to `group.created_at.date()` — the
date the group record was created via the API. This seemed reasonable in
isolation, but this app's entire point is importing *historical* CSV data.
When I actually ran the import against the real fixture (Feb 2026 rows) with
a group created "today," Aisha — the group's own creator — got flagged as a
`membership_mismatch` on her own February rent payment, because per the
membership table she hadn't joined yet.

**Caught by:** Running the actual HTTP import endpoint against the real CSV
and reading the anomaly list, not just checking that migrations ran.

**Correction:** Added an optional `creator_joined_at` field on group
creation, defaulting to today but overridable — and surfaced it in the
frontend's "New group" dialog with an explicit hint ("backdate this if
you're importing an old spreadsheet"), rather than leaving it as a hidden
API parameter only I would know to set.

**Why this mattered:** It's a one-line bug that would have silently broken
every historical import for every new group, and it would never have shown
up in a unit test that creates its own fixture data with "today" as the
join date by convention — it only surfaced by using the app the way an
actual user would.

### 2. `?format=text` collided with DRF's reserved query parameter

**Problem:** The import report endpoint was designed to return JSON by
default and a downloadable `.txt` file when called with `?format=text`.
Every call to the JSON version worked; every call with `?format=text`
returned a bare `{"detail": "Not found."}` with no indication of why.

**Caught by:** Live curl testing — the JSON endpoint worked, the exact same
endpoint with one query parameter added didn't, which narrowed it down fast.
Reading the DRF source/docs confirmed `format` is a reserved parameter used
by DRF's own content-negotiation system to pick a renderer (e.g.
`?format=json`), and since no `text` renderer was registered, DRF's
routing rejected the request before it ever reached my view code.

**Correction:** Renamed the parameter to `?download=text`, which has no
special meaning to DRF. Also added a comment in the view explaining why,
so a future change doesn't reintroduce the same collision.

**Why this mattered:** This is exactly the kind of framework-specific gotcha
that doesn't show up by reading the code — it only shows up by running it
against a real server, which is why the whole backend was smoke-tested with
curl before the frontend was built against it.

### 3. Duplicate detection was too literal to catch a real duplicate

**Problem:** The first version of the duplicate-detection rule matched on
`(date, normalized title)`. This missed the actual "Dinner at Marina
Bites" duplicate in the CSV, because the two rows have slightly different
title text ("Dinner at Marina Bites" vs "dinner - marina bites") — a
realistic case of someone re-entering the same expense in their own words.
Running the importer against the real file and checking the anomaly list
against the ones I'd found by hand (during initial data review) surfaced
the gap directly: the expected duplicate wasn't flagged at all.

**Correction:** Split duplicate detection into two tiers — an exact match
on `(date, payer, amount)` for clear copy-paste duplicates, and a separate
fuzzy title-token-overlap check (for same-date rows with a different payer
or amount, like the Thalassa dinner logged twice with two different
numbers) classified as a distinct `conflicting_duplicate` type, since the
two situations need different resolution options in the UI (skip-or-keep
vs. genuinely-not-sure-which-number-is-right).

**Why this mattered:** It's the difference between an importer that looks
correct because it runs without errors, and one that's actually verified
against the specific anomalies it was supposed to catch. This is also why
`test_importer.py` asserts against the real row numbers and real anomaly
types in `expenses_export.csv`, not synthetic fixture data — a synthetic
fixture built to match my own mental model of "what a duplicate looks like"
would have had the same blind spot as the code.

## What this process didn't catch (known limitation)

Ambiguous dates (row 54's notes literally ask "is this April 5 or May 4?")
aren't algorithmically detected — there's no reliable rule to flag "this
specific date might be wrong" without parsing free-text notes with NLP,
which felt like over-engineering for one row. It's documented as a scope
limit in `SCOPE.md` rather than silently left out.
