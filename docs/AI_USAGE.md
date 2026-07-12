# AI Usage

## Tools, and what each one actually did

I used three AI tools for different jobs, not one tool for everything.

- **ChatGPT** — used first, to understand the assignment itself. The brief
  is dense (dynamic membership, multi-currency, 12+ deliberate CSV
  anomalies, a live 45-minute defense session) and I went back and forth
  with it asking what each part actually meant in practice before writing
  any code — e.g. what "settlement is not an expense" implies for the
  schema, what "minimize transactions" means for the balance engine, why
  the assignment cares about audit trails at all. This was scoping and
  requirements clarification, not code generation.
- **DeepSeek** — used for small, self-contained frontend pieces: individual
  buttons, spacing/layout tweaks, and shape/style details in components
  like the member avatar chips and panel layouts. Nothing here touched
  business logic — it's presentational only.
- **Claude** — used for everything that actually decides behavior: the
  Django models, the balance engine, the CSV importer and anomaly
  detection, the API layer, the React data-fetching/state logic, and all
  the live debugging once the app was deployed (Render + Vercel +
  Supabase). This is the bulk of the work and the part I can defend line
  by line.

## Working approach

Built decision-by-decision, not from one giant prompt. For every ambiguous
call in the data (duplicate handling, refund vs. error, guest participants,
FX rate source, rounding rule), I made the call, Claude implemented it, and
I ran it — migrations applied, tests executed, the dev server hit with real
requests against the real `expenses_export.csv` — before moving to the next
piece. Decisions are logged in `DECISIONS.md` as they were made.

Deployment was its own second phase: once Auth → Balance engine → CSV
importer → API layer were built and tested locally, I deployed to Render +
Vercel + Supabase and debugged the app live against production traffic,
which surfaced several bugs that never showed up locally (see below).

## Key prompts (paraphrased, in order)

1. ChatGPT: "Walk me through what this assignment is actually asking for,
   module by module, before I start building."
2. Claude: "Read the actual assignment doc and the uploaded spreadsheet
   before building anything — don't generate a generic Splitwise clone."
3. Claude, for each ambiguous data problem: "here are the options, what are
   the tradeoffs" → I picked, Claude logged the decision.
4. Claude: "Build the balance engine first, as its own module, with tests
   against real rows from the CSV, before touching the API or frontend."
5. Claude: "Run the importer against the real CSV file and show me what it
   actually detects, not what we assume it detects."
6. Claude, post-deployment: "Import is timing out in production, here's the
   HAR file — check the actual numbers, don't guess."
7. DeepSeek: targeted prompts per component, e.g. "clean up the spacing and
   avatar layout on this members list" — scoped to one file at a time.

## Cases where AI-generated code was wrong

### 1. Group creator's join date hardcoded to "today"

**Problem:** `GroupViewSet.perform_create` set the creator's
`GroupMembership.joined_at` to the date the group record was created via
the API. This app's whole point is importing *historical* CSV data — when I
ran the import against the real fixture (Feb 2026 rows) with a group
created "today," Aisha, the group's own creator, got flagged as a
`membership_mismatch` on her own February rent, because per the membership
table she hadn't joined yet.

**Caught by:** Running the actual HTTP import endpoint against the real CSV
and reading the anomaly list, not just checking that migrations ran.

**Correction:** Added an optional `creator_joined_at` field on group
creation (defaults to today, overridable), surfaced in the frontend's "New
group" dialog with an explicit hint to backdate it for old spreadsheets.

### 2. MUI icon imports crashed the production build — took three attempts to actually fix

**Problem:** `MembersPanel.tsx` used `@mui/icons-material` icon imports
that worked fine in local dev but broke the Vercel production build. This
wasn't a one-shot fix: the commit history has three separate attempts
(`a21bdb0`, `a7fb38b`, `3d12383`, all titled the same) before it actually
stuck, because the first two fixes addressed the symptom in one spot without
catching every icon import in the file.

**Caught by:** The Vercel deploy log failing, then re-checking the deployed
site after each attempted fix and finding it still broken.

**Correction:** Replaced the icon imports with plain buttons/text glyphs
throughout the component instead of patching individual imports one at a
time — a broader fix instead of a narrow one, once I noticed the first two
attempts hadn't covered every usage.

**Why this mattered:** A live interviewer could plausibly ask "why is this
a button and not an icon" — this is the honest answer, and it's also a good
example of a fix that looked done twice before it actually was.

### 3. `?format=text` collided with DRF's reserved query parameter

**Problem:** The import report endpoint was meant to return JSON by default
and a downloadable `.txt` file with `?format=text`. The JSON version worked;
`?format=text` returned a bare `{"detail": "Not found."}` with no reason why.

**Caught by:** Live curl testing — same endpoint, one query param added,
broke. Checking DRF's docs confirmed `format` is reserved for DRF's own
content-negotiation system, and since no `text` renderer was registered,
the request never reached my view code at all.

**Correction:** Renamed the parameter to `?download=text`.

### 4. `build_report()` silently omitted the fields the interactive UI needed — every "Apply" click failed for weeks without erroring

**Problem:** `ImportPanel`'s per-anomaly "Apply" button reads `anomaly.id`
to build its resolve request (`POST /anomalies/{id}/resolve/`). But the
anomaly list on screen was powered by `/import-batches/{id}/report/`, which
calls `build_report()` — a function originally written only to produce the
downloadable `.txt` report, so it never included `id` or `raw_data` in its
per-anomaly JSON. Every single "Apply" click sent
`POST /anomalies/undefined/resolve/` and 404'd — for every anomaly, every
session, silently, since the frontend didn't surface the failed request as
a visible error.

**Caught by:** Checking a HAR file from a real resolve attempt and noticing
all 14 "Apply" clicks hit `undefined` in the URL — the resolutions from an
entire review session had never actually saved.

**Correction:** Added `id` and `raw_data` to `build_report()`'s per-anomaly
output. Confirmed safe by checking the `.txt` renderer only reads fields it
names explicitly, and re-ran the test suite.

**Why this mattered:** This is the scariest kind of bug for this
assignment specifically — Meera's whole requirement is "let me approve
changes," and for a while the approve button silently did nothing. It never
threw a visible error because the frontend didn't show the 404. I only
caught it by reading the network traffic, not by trusting that clicking
"Apply" and seeing the modal close meant it worked.

### 5. N+1 queries made both expense listing and the import report slow in production

**Problem:** Two separate spots fetched related data in a loop instead of
in one query. `ExpenseViewSet`'s queryset fetched each expense's `paid_by`
and each participant's `user` individually — confirmed by a real test:
20 expenses × 3 participants went from 101 queries down to 3 after the fix.
Separately, `build_report()`'s `resolved_by.display_name` lookup fired one
query per resolved anomaly. Combined with the database being in a different
region than the backend, a 14-anomaly report request was making up to ~17
round trips, each paying real cross-region latency — enough to make the
import review page visibly drag as more anomalies got resolved.

**Caught by:** Watching real load times climb during an actual import
session (not a synthetic benchmark), then confirming the query count
directly with `select_related`/`prefetch_related` before/after and a test
asserting the query count.

**Correction:** `select_related("paid_by", "group")` +
`prefetch_related("participants__user")` on the expense queryset;
`select_related("resolved_by")` in `build_report()`.

**Why this mattered:** It's the difference between code that's "correct"
in isolation and code that survives being used with real, growing data —
and it's a good concrete example for the "modify something live" part of
the interview, since the fix is small, isolated, and easy to explain.

## What this process didn't catch (known limitation)

Ambiguous dates (one row's own notes ask "is this April 5 or May 4?")
aren't algorithmically detected — flagging free-text ambiguity like that
reliably would need NLP over the notes field, which felt like
over-engineering for one row. Documented as a scope limit in `SCOPE.md`,
not silently dropped.