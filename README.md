# AI Office

Local 3D office where AI agents are the staff. Stage 1: scaffold.

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
pip install -r requirements.txt
alembic upgrade head
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
- http://localhost:3000 → scene with a cube and "API: ok" in the top-right corner

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
