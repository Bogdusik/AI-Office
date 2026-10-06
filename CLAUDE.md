# AI Office

Local app (localhost only, single user, no auth): a 3D office building where I am the director and the staff are AI agents. I give a task, an agent works through it in stages, I accept the result or send it back.

## Core principle
State lives in the database; the 3D scene only renders it. No business logic in the scene.

## Stages
1. Scaffold  ← **current**
2. Data model and API
3. Static building
4. Clicks and panels
5. Tasks with a fake executor
6. Real AI via Ollama + web search
7. Life animation
8. Polish

Do only the current stage. Don't jump ahead.

## Stack
- `frontend/` — Next.js 15 (App Router), TypeScript strict, Tailwind v4, @react-three/fiber, @react-three/drei, zustand.
- `backend/` — Python 3.11, FastAPI, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2, pydantic-settings.
- PostgreSQL 16 in docker-compose (DB only, host port 5433 — 5432 is taken by a local Postgres). Backend and frontend run locally.

## Layout
- `backend/app/core/config.py` — settings from `backend/.env`
- `backend/app/db/` — engine, session, `Base` (Alembic `target_metadata`)
- `backend/app/api/` — one router per domain
- `frontend/src/components/scene/` — R3F scene (render only)
- `frontend/src/components/hud/` — DOM overlays
- `frontend/src/store/` — zustand stores

## Rules
- Secrets only in `.env` files (git-ignored); keep `.env.example` in sync.
- Schema changes only via Alembic migrations.
- No auth, no extra libraries without a reason.
