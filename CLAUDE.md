# AI Office

Local app (localhost only, single user, no auth): a 3D office building where I am the director and the staff are AI agents. I give a task, an agent works through it in stages, I accept the result or send it back.

## Core principle
State lives in the database; the 3D scene only renders it. No business logic in the scene.

## Stages
1. Scaffold — done
2. Data model and API — done
3. Static building  ← **current**
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

## Data model
- `profile` — single row (`id = 1`): name, summary, goal, constraints, notes (markdown).
- `floors` — unique `number`, `capacity` (default 5), `has_director_office`.
- `agents` — on a floor at a `desk_index` (unique per floor, `0..capacity-1`); `role_key` unique among active agents; `provider` ollama|anthropic, optional `model`, `web_access`, scene `status`. Never deleted: `DELETE` archives (`archived_at` set, `floor_id`/`desk_index` cleared). Archived agents are hidden from `/state` and don't count toward capacity.
- `tasks` — per agent (FK `RESTRICT`), `status`, optional `stage` (plan|research|draft|self_check), queue `position`, timestamps.
- `task_comments` (director|agent), `runs` (one LLM call per stage, tokens, error), `artifacts` (versioned markdown + `sources` URL list) — all hang off a task.

Task status flow (enforced in `app/services/rules.py`, anything else → 409):
`queued → in_progress → needs_review → done`, `needs_review → changes_requested → in_progress`, `in_progress ↔ paused`, `in_progress → failed`, any unfinished → `cancelled`.
Director actions: approve, request-changes (comment required), pause, resume, cancel. `start`/`submit_for_review`/`fail` are executor-only service functions (no HTTP yet).

`GET /api/v1/state` is the scene's single snapshot: floors → active agents with `current_task` (priority in_progress > changes_requested > paused > needs_review), `queue_length`, `awaiting_review`.

## Layout
- `backend/app/core/config.py` — settings from `backend/.env`
- `backend/app/db/` — engine, session, `Base` (Alembic `target_metadata`)
- `backend/app/models/` — ORM models; enums stored as VARCHAR + CHECK
- `backend/app/services/` — business logic; `rules.py` is pure functions, `errors.py` domain errors (→ 404/409/422 in `main.py`)
- `backend/app/api/v1/` — thin routers under `/api/v1`
- `backend/app/seed/` — idempotent seed (`python -m app.seed`), never overwrites existing rows
- `backend/tests/` — pytest on a separate `ai_office_test` DB, recreated and migrated each run
- `frontend/src/lib/api.ts` — `WorldState` types (mirror `backend/app/schemas/state.py`) + `fetchState`
- `frontend/src/store/useWorldStore.ts` — polls `/api/v1/state` every 3 s; only replaces `world` when the payload changed
- `frontend/src/store/useUiStore.ts` — UI-only state: selected floor, `?preview=1`, camera "home" requests
- `frontend/src/scene/layout.ts` — **all** scene geometry as pure functions of world data (floor stacking, desks, office, core, entrance, parking, camera home)
- `frontend/src/scene/palette.ts` — colours; one accent (`#ff7a59`) for director-related things
- `frontend/src/components/scene/` — R3F scene from primitives (render only, reads stores)
- `frontend/src/components/hud/` — DOM overlays (floor switcher, home, preview badge, API status)

## Scene
- Floor plan zones: desk grid (from `capacity`), side zone (director office or lounge), and on the ground floor only a front lobby strip (reception, waiting area) with full-height glass doors, canopy and card reader.
- Floors stack by sorted `number`. The slab pitch comes from `floorPitch()`: just enough air so every back-row plaque of a lower floor is visible from the home camera.
- Core on the −x side: glass elevator shaft in front (landing doors on the building's inner wall), switchback stairs with landings and rails behind it.
- Walls exist on all four sides and fade when they face the camera (`facadeOpacity` + `parts/Fade`), damped per frame, no React re-renders. Entrance doors/canopy never fade.
- Labels and plaques turn to the camera around Y (`parts/FaceCamera`); don't use drei `Billboard` with locked axes — it flips when the camera is behind.
- Agent + their car are shown only when `status !== 'off_site'`, or always with `?preview=1` (UI-only, never writes to the DB).
- Parking: spot 0 director, then one spot per desk (floor order, `desk_index`), then 2 guest spots; separate entry/exit lanes with barriers.
- Camera: drei `CameraControls` (orthographic). Left drag rotates 360° (polar clamped 15–75°), right drag pans (target clamped around the building), wheel zooms smoothly to the cursor; "home" animates back to `cameraHome()`.
- Labels use a local font (`public/fonts/Inter-SemiBold.woff`), each wrapped in its own Suspense.

## Rules
- Secrets only in `.env` files (git-ignored); keep `.env.example` in sync.
- Schema changes only via Alembic migrations.
- No auth, no extra libraries without a reason.
- No coordinates in components: placement comes from `scene/layout.ts`; components only hold the internal proportions of a primitive model (desk, chair, car).
- Merge feature branches into `main` with a regular merge (no squash).
