# AI Office

Local 3D office where AI agents are the staff. Stage 7b: the building from `GET /api/v1/state` with selection, panels and a HUD; a background executor drives agents (arrive → work through stages → review → leave) on a local model in Ollama, live over server-sent events. Agents with web access search and read pages (local SearXNG) and cite sources. Agents drive in, park, badge in, take the lift or the stairs to their desk, and leave the same way. In between they type while the model writes for them, go for coffee when the model queue is long, wait for review in the lounge and chat when they are free — all from the real state, no generated dialogue.


Controls: left drag — rotate, right drag — pan, wheel — zoom to cursor, «Домой» — back to the default view.
Click an agent, a free desk, the director's office or a parking spot to open its panel; Esc closes the innermost layer. «Кабинет директора» opens the team table, review queue, profile and floor management.

«Жизнь офиса» in the HUD switched off keeps everyone at their desks; «Анимация» off turns all movement off (agents and cars then appear and disappear); «Следить» in an agent's panel makes the camera follow them.

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

The task executor starts with the backend. Its timings live in `backend/.env` (`EXECUTOR_ARRIVE_SECONDS` and `EXECUTOR_DEPART_SECONDS` 75 s — the length of the drive-in/drive-out animation, `EXECUTOR_STAGE_SECONDS` 5 s for the fake worker); `EXECUTOR_ENABLED=false` turns it off. `--timeout-graceful-shutdown 2` lets the server reload while browsers hold the `/api/v1/events` stream open.

**Local model.** Install [Ollama](https://ollama.com) (0.35+), then `ollama pull qwen3.8:27b` (17 GB; fits a 24 GB GPU with a 16K context) and set `EXECUTOR_WORKER=llm` in `backend/.env` (`fake` gives placeholder text with no model). `OLLAMA_MODEL` sets the default model, an agent's «Модель» field overrides it. The HUD dot next to «API» turns red when Ollama is down or the model is missing. Model comparison: `docs/model-benchmark.json`.

**Web search.** `docker compose up -d` also starts SearXNG on `127.0.0.1:8888` (local only); set `SEARXNG_SECRET` in the root `.env` (any long random string). Agents with «Доступ в интернет» search and read pages during the research stage; results come with numbered sources. Click the server room (Engineering floor) for model, GPU, queue and token numbers.

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
