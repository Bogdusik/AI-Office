# AI Office

Local 3D office where AI agents are the staff. Stage 6a: the building from `GET /api/v1/state` with selection, panels and a HUD; a background executor drives agents (arrive → work through stages → review → leave) on a local model in Ollama, live over server-sent events. Web search comes in 6b.


Controls: left drag — rotate, right drag — pan, wheel — zoom to cursor, «Домой» — back to the default view.
Click an agent, a free desk, the director's office or a parking spot to open its panel; Esc closes the innermost layer. «Кабинет директора» opens the team table, review queue, profile and floor management.

Add `?preview=1` to the URL to see every agent at their desk and every car parked, without touching the database. `?routes=1` draws the car route graph.

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
uvicorn app.main:app --reload --port 8000 --timeout-graceful-shutdown 2

# 3. Frontend (new terminal)
cd frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

## Daily run

```powershell
docker compose up -d
cd backend; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000 --timeout-graceful-shutdown 2
cd frontend; npm run dev
```

The task executor starts with the backend. Its timings live in `backend/.env` (`EXECUTOR_ARRIVE_SECONDS`, `EXECUTOR_STAGE_SECONDS`, `EXECUTOR_DEPART_SECONDS`, 5 s each by default); `EXECUTOR_ENABLED=false` turns it off. `--timeout-graceful-shutdown 2` lets the server reload while browsers hold the `/api/v1/events` stream open.

**Local model.** Install [Ollama](https://ollama.com) (0.35+), then `ollama pull qwen3.8:27b` (17 GB; fits a 24 GB GPU with a 16K context) and set `EXECUTOR_WORKER=llm` in `backend/.env` (`fake` gives placeholder text with no model). `OLLAMA_MODEL` sets the default model, an agent's «Модель» field overrides it. The HUD dot next to «API» turns red when Ollama is down or the model is missing. Model comparison: `docs/model-benchmark.json`.

## Check
- `Invoke-RestMethod http://localhost:8000/health` → `{"status":"ok","db":true}`
- `Invoke-RestMethod http://localhost:8000/api/v1/state` → 3 floors, 6 agents
- `Invoke-RestMethod http://localhost:8000/api/v1/llm/status` → `ok: true` with the model name
- API docs: http://localhost:8000/docs
- http://localhost:3000 → the office, with "API: ok" and the model dot in the top-right corner

## Tests

Frontend layout checks: `cd frontend; npm run check:layout`.


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
