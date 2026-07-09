# Shared Expenses

A shared-expenses app (Splitwise-style) built for four flatmates whose
spreadsheet turned into a mess. Built for a Practice School-III / internship
assignment — full requirements in the original assignment doc.

## Stack

- **Backend:** Django 6 + Django REST Framework, JWT auth (SimpleJWT), PostgreSQL (Supabase in production, sqlite locally)
- **Frontend:** React 19 + TypeScript + Vite, MUI v5, React Router, TanStack Query, Axios
- **Deployment:** Backend on Render, frontend on Vercel, DB on Supabase Postgres

## Local setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # sqlite works out of the box, no DB setup needed
python manage.py migrate
python manage.py createsuperuser  # optional, for /admin/
python manage.py runserver
```
Backend runs at `http://localhost:8000`, API under `/api/`.

Run the test suite (22 tests, several run against the real
`expenses_export.csv` fixture in `backend/expenses/fixtures/`):
```bash
python manage.py test expenses
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env            # points at localhost:8000 by default
npm run dev
```
Runs at `http://localhost:5173`.

## Deployment

### Database — Supabase Postgres
1. Create a Supabase project.
2. Copy the connection string (Project Settings → Database → Connection string, "URI" format, use the pooler connection for serverless-friendly connection limits).
3. Set it as `DATABASE_URL` in Render's environment variables (see below).

### Backend — Render
1. New Web Service, connect this repo, root directory `backend/`.
2. Build command: `pip install -r requirements.txt && python manage.py collectstatic --noinput`
3. Start command is read from `Procfile` (`gunicorn config.wsgi`); the `release` line runs migrations automatically on each deploy.
4. Environment variables (see `.env.example`): `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, `DJANGO_ALLOWED_HOSTS` (include your `.onrender.com` domain), `DATABASE_URL` (from Supabase), `CORS_ALLOWED_ORIGINS` (your Vercel URL).

### Frontend — Vercel
1. Import this repo, root directory `frontend/`.
2. Framework preset: Vite.
3. Environment variable: `VITE_API_BASE_URL` = your Render backend URL + `/api`.
4. `vercel.json` handles SPA routing (all paths rewrite to `index.html`) so React Router's client-side routes work on refresh.

## Architecture

```
backend/
  accounts/          custom User model (adds display_name for CSV name matching)
  expenses/
    models.py         Group, GroupMembership, Expense, ExpenseParticipant,
                       Settlement, ImportBatch, ImportAnomaly
    services/
      splitting.py     equal/exact/unequal/percentage/share split math + rounding rule
      balances.py      net balance engine, debt simplification, audit trail
      importer.py      CSV anomaly detection (2-pass: detect, then human-resolve)
      resolution.py    turns a human's chosen action into a DB write
      report.py        import report (JSON + downloadable text)
    views.py           REST API
    tests/             22 tests, several against the real CSV
  config/              Django settings, urls
frontend/
  src/
    api/               typed API client + TypeScript types mirroring the serializers
    context/           auth state
    pages/              Login, Register, Groups list, Group detail (tabs)
    components/         MembersPanel, ExpensesPanel, ExpenseForm, BalancesPanel, ImportPanel
docs/
  DECISIONS.md         engineering decision log
  SCOPE.md             anomaly log + database schema
  AI_USAGE.md          AI tool usage, prompts, and caught mistakes
```

## API endpoints (non-exhaustive — see `expenses/urls.py` / `accounts/urls.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register/` | Create account |
| POST | `/api/auth/login/` | Get JWT access + refresh tokens |
| GET | `/api/groups/` | List your groups |
| POST | `/api/groups/` | Create a group (optionally backdate your own join date) |
| POST | `/api/groups/{id}/add_member/` | Add a member |
| POST | `/api/groups/{id}/members/{membership_id}/leave/` | Mark a member as left (preserves history) |
| GET/POST | `/api/expenses/?group={id}` | List/create expenses |
| GET/POST | `/api/settlements/?group={id}` | List/create settlements |
| GET | `/api/groups/{id}/balances/` | Net balance per person + minimized settlement suggestions |
| GET | `/api/groups/{id}/balances/{user_id}/trail/` | Full audit trail behind one person's balance |
| POST | `/api/groups/{id}/import/` | Upload CSV, run anomaly detection |
| POST | `/api/anomalies/{id}/resolve/` | Approve/reject/correct a detected anomaly |
| GET | `/api/import-batches/{id}/report/` | Import report (add `?download=text` for a file) |

## AI usage

Built with Claude as the primary development collaborator. See `docs/AI_USAGE.md`
for prompts used and specific cases where AI-generated code was wrong and had
to be corrected.
