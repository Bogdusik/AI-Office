# AI Office

Local 3D office where AI agents are the staff. Stage 3: static building rendered from `GET /api/v1/state`.


Controls: left drag — rotate, right drag — pan, wheel — zoom to cursor, «Домой» — back to the default view.

Add `?preview=1` to the URL to see every agent at their desk and every car parked, without touching the database.

## Requirements
- Docker Desktop
- Python 3.11
- Node.js 20+

## First run (Windows PowerShell)

```powershell
# 1. Database
Copy-Item .env.example .env          # set POSTGRES_PASSWORD
docker compose up -d

# 2. Backend
cd backend
Copy-Item .env.example .env          # use the same password in DATABASE_URL
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
alembic upgrade head
python -m app.seed                   # safe to re-run
uvicorn app.main:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

## Daily run

```powershell
docker compose up -d
cd backend; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000
cd frontend; npm run dev
```

## Check
- `Invoke-RestMethod http://localhost:8000/health` → `{"status":"ok","db":true}`
- `Invoke-RestMethod http://localhost:8000/api/v1/state` → 2 floors, 6 agents
- API docs: http://localhost:8000/docs
- http://localhost:3000 → scene with a cube and "API: ok" in the top-right corner

## Tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest
```

Tests use `TEST_DATABASE_URL` from `backend/.env` (database `ai_office_test` in the same container). It is dropped, recreated and migrated on every run — never point it at real data.

## Ports
| Service  | Port |
|----------|------|
| Postgres | 5433 |
| Backend  | 8000 |
| Frontend | 3000 |

## Stop
```powershell
docker compose down       # keep data
docker compose down -v    # drop data volume
```
