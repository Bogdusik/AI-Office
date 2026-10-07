# AI Office

Local app (localhost only, single user, no auth): a 3D office building where I am the director and the staff are AI agents. I give a task, an agent works through it in stages, I accept the result or send it back.

## Core principle
State lives in the database; the 3D scene only renders it. No business logic in the scene.

## Stages
1. Scaffold — done
2. Data model and API — done
3. Static building — done
4. Clicks and panels — done
5. Tasks with a fake executor — done
6. Real AI via Ollama + web search — 6a (local model) ← **current**, 6b web search next
7. Life animation
8. Polish

Do only the current stage. Don't jump ahead.

## Stack
- `frontend/` — Next.js 15 (App Router), TypeScript strict, Tailwind v4, @react-three/fiber, @react-three/drei, zustand.
- `backend/` — Python 3.11, FastAPI, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2, pydantic-settings.
- PostgreSQL 16 in docker-compose (DB only, host port 5433 — 5432 is taken by a local Postgres). Backend and frontend run locally.

## Data model
- `profile` — single row (`id = 1`): name, summary, goal, constraints, notes (markdown).
- `floors` — unique `number`, `kind` reception|office (at most one reception), `capacity` (reception = 0 and no agents; office > 0, default 5), `has_director_office`. Standard building: 1 Reception, 2 Career, 3 Engineering (director office).
- `agents` — on a floor at a `desk_index` (unique per floor, `0..capacity-1`); `role_key` unique among active agents; `provider` ollama|anthropic, optional `model`, `web_access`, scene `status`. Never deleted: `DELETE` archives (`archived_at` set, `floor_id`/`desk_index` cleared). Archived agents are hidden from `/state` and don't count toward capacity.
- `tasks` — per agent (FK `RESTRICT`), `status`, optional `stage` (plan|research|draft|self_check), queue `position`, timestamps.
- `task_comments` (director|agent), `runs` (one stage of one `attempt` = the artifact version it works towards; `provider` ollama|anthropic|fake, `output` text, `sources`, tokens, status running|succeeded|failed|interrupted|cancelled, error), `artifacts` (versioned markdown + `sources` URL list) — all hang off a task.

Task status flow (enforced in `app/services/rules.py`, anything else → 409):
`queued → in_progress → needs_review → done`, `needs_review → changes_requested → in_progress`, `in_progress → paused → queued` (resume puts it at the front of the queue), `in_progress → failed`, any unfinished → `cancelled`.
Director actions: approve, request-changes (comment required), pause, resume (paused only), cancel. Only the executor moves a task to `in_progress`, `needs_review` or `failed`.
Floors: the reception and the director-office floor can't be deleted (409).

`GET /api/v1/state` is the scene's single snapshot: floors → active agents with `current_task` (priority in_progress > changes_requested > paused > needs_review), `queue_length`, `awaiting_review`; plus `stats` (`tasks_in_progress`, `awaiting_review` over active agents, `done_today` = tasks done since local midnight of the server).

## Layout
- `backend/app/core/config.py` — settings from `backend/.env`
- `backend/app/db/` — engine, session, `Base` (Alembic `target_metadata`)
- `backend/app/models/` — ORM models; enums stored as VARCHAR + CHECK
- `backend/app/services/` — business logic; `rules.py` is pure functions, `errors.py` domain errors (→ 404/409/422 in `main.py`)
- `backend/app/api/v1/` — thin routers under `/api/v1`
- `backend/app/seed/` — idempotent seed (`python -m app.seed`), never overwrites existing rows
- `backend/tests/` — pytest on a separate `ai_office_test` DB, recreated and migrated each run
- `frontend/src/lib/api.ts` — API types (mirror backend schemas) + `api.*` calls; non-2xx → `ApiError`
- `frontend/src/lib/errors.ts` — `humanize()`: backend 409/422/404 details → Russian text for the director
- `frontend/src/lib/labels.ts` — Russian names + colours of agent/task statuses and stages; `lib/stages.ts` — stage ribbon mapping
- `frontend/src/store/useWorldStore.ts` — polls `/api/v1/state` every 3 s; only replaces `world` when the payload changed
- `frontend/src/store/useTasksStore.ts` — all tasks (`GET /tasks`), reloaded when `world` changes or after an action, not every poll
- `frontend/src/store/actions.ts` — `mutate()`: every write refreshes world + tasks right away (also on error) and bumps `revision` so open details refetch
- `frontend/src/store/useUiStore.ts` — UI-only state: selected floor, `?preview=1`, camera home/focus requests, selection, hover, open task, director panel, collapsed HUD blocks; `back()` = Esc
- `frontend/src/scene/layout/` — **all** scene geometry as pure functions (import as `@/scene/layout`):
  `types` (Part, place), `dims` (DIM, CAMERA, FADE), `models` (primitive furniture/cars/trees as parts), `building` (floors, zones, walls, core, stairs, entrance, roof),
  `site` (roads, intersection, parking, fence, car route graph), `greenery`, `camera` (home view, wall/roof fading), `picks` (selection keys + click volumes), `assemble` (`buildScene` → parts, walls, labels, roof, routes, picks)
- `frontend/scripts/check-layout.mts` — `npm run check:layout`: parking/route/pick invariants of the pure layout + stage ribbon (no test runner)
- `frontend/src/scene/palette.ts` — colours; one accent (`#ff7a59`) for director-related things
- `frontend/src/components/scene/` — R3F scene from primitives (render only, reads stores)
- `frontend/src/components/hud/` — HUD overlay (`Hud` frame: metrics, floors, search, director button | stage ribbon, office list), Esc hotkey
- `frontend/src/components/panels/` — right panels (agent, task card, hire, parking spot) and the full-screen director panel; `ui.tsx` shared primitives

## Scene
- Office floors: desk grid (from `capacity`; desk with 2 monitors, speakers, bottle, executive chair), side zone (director office or lounge), kitchen zone. The reception floor has no desks: two-seat counter with two static staff figures (decor, not agents), guest seating groups, big glass doors with canopy and card reader.
- Rendering: `buildScene()` returns parts; `parts/Batches` draws them with one InstancedMesh per (shape, finish). Walls are merged per wall (`parts/Walls`) so each can fade. Only the sun casts shadows; no other light sources.
- Roof (parapet, HVAC, AC units) shows only in "All" mode and fades in when zoomed well out (`roofOpacity`).
- Roads: main road + cross road with an intersection; UK left-hand traffic. `routes()` gives arrive (map edge → entry barrier), toSpot, fromSpot, depart (exit barrier → map edge); `?routes=1` draws them. Cars don't move yet (stage 7).
- Floors stack by sorted `number`. The slab pitch comes from `floorPitch()`: just enough air so every back-row plaque of a lower floor is visible from the home camera.
- Core on the −x side: glass elevator shaft in front (landing doors on the building's inner wall), switchback stairs with landings and rails behind it.
- Walls exist on all four sides and fade when they face the camera (`facadeOpacity` + `parts/Fade`), damped per frame, no React re-renders. Entrance doors/canopy never fade.
- Labels and plaques turn to the camera around Y (`parts/FaceCamera`); don't use drei `Billboard` with locked axes — it flips when the camera is behind.
- Agent + their car are shown only when `status !== 'off_site'`, or always with `?preview=1` (UI-only, never writes to the DB).
- Parking: spot 0 director, then one spot per desk (floor order, `desk_index`), then 2 guest spots; separate entry/exit lanes with barriers; perimeter fence with a gap at the lanes.
- Camera: drei `CameraControls` (orthographic). Left drag rotates 360° (polar clamped 15–75°), right drag pans (target clamped to the whole site), wheel zooms smoothly to the cursor; "home" animates back to `cameraHome()`.
- Labels use a local font with Cyrillic (`public/fonts/Inter-SemiBold.ttf`), each wrapped in its own Suspense. Plaques and car tags show title + status (stripe = status colour).

## Selection and panels (stage 4)
- Clickable: agent (whole workstation), free desk, director office, parking spot. `buildScene` returns `picks` (invisible boxes); `parts/Picking` is one instanced hit mesh, `parts/Highlight` draws hover/selection frames. Clicks after a drag (>4 px) are ignored; a click on nothing clears the selection.
- The scene only reads selection from `useUiStore`. `focusOn()` (HUD list, search, director table) also switches to the object's floor and asks `CameraRig` to glide there (same angle, closer zoom).
- Right panel: agent (tasks grouped: current, queue, review, finished; new task form; edit; archive with confirm), task card (actions by status, mirroring `rules.py`), hire on a free desk, parking spot. Director panel: team table, review queue, profile, floors (delete only empty office floors without the director office — UI rule).
- HUD rows stop short of the right panel (`useRightPanelOpen`); desktop only, no mobile layout.
- Dev-only `window.__aiOffice.screenOf(key)` gives page coordinates of a pick, so browser tests click real objects.

## Executor and agent lifecycle (stage 5)
- `app/executor/`: `Executor` starts with the app (`lifespan`, `EXECUTOR_ENABLED`). A supervisor loop keeps one asyncio worker per agent with something to do: agents run in parallel, each on one task at a time. A Postgres advisory lock allows one executor per database; every step is a short transaction that re-checks the status under `FOR UPDATE`, so director actions always win.
- Stage work is behind `StageWorker.run(StageInput, StageReport) -> StageOutput` (task, stage, version, profile, agent, comments, earlier stage outputs, earlier results → text, tokens, sources) plus `model_for(agent)`. `StageReport` lets a worker say `waiting()` (queued for the GPU → run status `waiting`), `started()` (request sent → `running`, `started_at` reset) and `partial(text)` (saved to `run.output` every `EXECUTOR_PROGRESS_SECONDS`, SSE `progress`). A `StageError` message is stored on the run as is (it is meant for the director). `EXECUTOR_WORKER=fake|llm` picks `FakeWorker` (placeholder, `provider = fake`) or `LlmWorker`.
- Stage list: `rules.task_stages(web_access, version)` — the single place to change it. Version 1: plan, research (web access only), draft, self_check. Version 2+ (rework): plan skipped, starts from research/draft with the director's comments and the previous result.
- Pick order: `in_progress` (after a restart) → `changes_requested` → `queued` by position.
- Agent `status`: `off_site` + work → `arriving` (EXECUTOR_ARRIVE_SECONDS) → `idle` → `working` (stages; one `Run` each) → after self_check a new artifact version, task → `needs_review`, next task. No work but something in review → `waiting_review` (stays). Only paused tasks left → `idle` (stays, waits for the director). Everything finished/cancelled → `leaving` (EXECUTOR_DEPART_SECONDS) → `off_site`. A new task during `leaving` brings the agent back after it has left.
- Pause takes effect at the stage boundary (the running stage finishes and is kept); resume continues from the first stage without a successful run of the current version. Cancel stops the running stage at once (run `cancelled`). Comments are read at the start of every stage. A stage error → run `failed` with the error, task `failed`, agent moves on.
- Restart: `running` runs become `interrupted`, the stage runs again; `arriving` restarts, `leaving` completes, other statuses are reconciled by the loop.
- Events: `app/events.py` in-process bus; services and the executor publish `agent` (status), `task` (status/stage, also on create), `artifact` (new version). `GET /api/v1/events` streams them as SSE (`retry`, 15 s ping). Frontend `EventSync` refreshes world + tasks on any event (debounced) and shows a notice for `needs_review`; `/state` polling is a 15 s fallback.
- Scene presence (`scene/layout/presence.ts`): arriving → car only; idle/working/waiting_review → car + person at the desk; leaving → car only; off_site → nothing. `?preview=1` shows everyone.
- Run the backend with `--timeout-graceful-shutdown 2`: open SSE streams otherwise block reloads. On Windows `--reload` can still hang while a model request streams (the old process keeps serving); restart uvicorn by hand after backend edits when the LLM worker is busy.

## LLM worker (stage 6a)
- `app/executor/llm.py` — Ollama `/api/chat`, streamed. Model: `OLLAMA_MODEL` (default `qwen3.8:27b`, chosen by `docs/model-benchmark.json`: ~100 tok/s on the RTX 4090, 19 GB VRAM with a 16K window, correct tool calls); an agent's `model` overrides it. Thinking on (`OLLAMA_THINK`), `OLLAMA_NUM_CTX=16384`.
- GPU queue: an `asyncio.Semaphore(LLM_CONCURRENCY)` in the worker; an agent waiting for it shows "Ждёт модель" (`/state` → `current_task.waiting_for_model`). Lifecycle status stays `working`.
- Stage timeout (`LLM_STAGE_TIMEOUT_SECONDS`) counts from sending the request, not from joining the queue. One retry (`LLM_RETRIES`) after a timeout, dropped stream, 5xx or connection error; a missing model (404) is not retried. Cancelling the task closes the stream and Ollama stops generating within ~1 s.
- Errors for the director: "Ollama не отвечает по адресу … Запустите Ollama и повторите задачу.", "Модель «…» не скачана в Ollama. Выполните: ollama pull …", "Модель «…» не ответила за N с (попыток: 2)."
- `app/executor/prompt.py` (pure): system = agent prompt + director profile + house rules (draft only, never send; no invented or inferred facts — every claim about the director must be in the profile/task/comments; gaps → `[NEEDS INPUT: …]`; English unless asked otherwise) + today's date. User = task, director comments, earlier stages of this version, previous result (rework), stage instruction. research says `Sources: not verified (no web access yet).` until stage 6b. self_check returns only the corrected deliverable (optionally `## Open items`), which becomes the artifact.
- Context: input budget = (`OLLAMA_NUM_CTX` − `LLM_RESERVE_TOKENS`) × 3.5 chars. Over budget, sections are cut in a fixed order (older stage outputs → older comments → latest stage output → profile → previous result → task last), head + tail kept, marked `[... truncated N chars ...]`. Agent prompt, rules, latest comment and the stage instruction are never cut.
- `GET /api/v1/llm/status` → worker, Ollama up, version, model available/loaded; HUD `ModelStatus` dot (green ok, red down/missing, grey fake).
- Task card: live stage block (status, model, Markdown of the text so far), result as Markdown (`react-markdown`, no raw HTML) with version tabs and «Копировать»; a failed task shows the stage error.

## Rules
- Secrets only in `.env` files (git-ignored); keep `.env.example` in sync.
- Schema changes only via Alembic migrations.
- No auth, no extra libraries without a reason.
- No sizes or coordinates in components: everything comes from `scene/layout/` (models included); components only render.
- Python edits on Windows: always pass `encoding="utf-8"` (the default cp1252 corrupts non-ASCII).
- Merge feature branches into `main` with a regular merge (no squash).
