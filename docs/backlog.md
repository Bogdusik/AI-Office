# Backlog

Ideas parked for later stages. Don't implement before their stage.

## Agent tools

- More job sources for `search_jobs` (my own SearchWork project, other official APIs) behind the same `JobSource` protocol.

## Agents working together (after stage 7)

- Real collaboration: an agent can hand part of a task to a colleague or ask them to review the result (a sub-task in the DB, with its own runs); in the scene the agent walks over to the colleague's desk.

## Stage 7 — Life animation (later parts)

- Arriving and leaving cars don't yet give way to each other in the parking aisle (leaving cars queue among themselves, arriving cars are spaced at the entry barrier); a car reversing out while another drives in can briefly overlap.
- When many agents leave at once, the exit barrier is the bottleneck: the planner makes the first cars drive off to the map edge slower or faster (up to ×2.5 / ×0.4 of the normal speed) to keep every trip at exactly its duration.

## Stage 8 — Polish

- Chandeliers and decorative lighting (emissive only — no extra light sources; shadows stay sun-only)
- Floor materials per zone (office carpet, lobby stone, kitchen tiles)
- Wall colours / accent walls per floor
- Rugs under desk clusters
- Pictures and posters on the walls
- Steam from the roof HVAC units
- Traffic lights at the intersection
- Interior v2: floors split into rooms by partitions with doors and a shared corridor — meeting room, lounge, kitchen as a separate room. Make the building wider and longer first, so the rooms fit next to the desk area.
- (Open question) Replace primitives with a ready-made glTF model pack — only after checking that its licence allows publishing.

## Audit leftovers (October 2026)

From the security and load audit; the items fixed on `fix/audit` are not listed. IDs are the audit's.

Security

- **L5** Text fields have no length limit (profile fields, task description, comments, an agent's `system_prompt`). Add `max_length` to the Pydantic schemas (e.g. 8 000 for profile fields, 50 000 for a description, 10 000 for a comment, 20 000 for a system prompt) and matching `maxLength` on the text areas.
- **L6** The Ollama clients (`executor/llm.py`, `services/llm_status.py`) follow system proxy settings (`trust_env` is on): a proxy set later would see every prompt, profile included. Pass `trust_env=False` as the other clients do.
- **L8.1** An unexpected exception's text goes into `run.error` and the task card. Keep only the exception type plus a fixed sentence for non-`StageError` failures and log the details.
- **L8.2** No cap on open `/api/v1/events` streams (each holds a queue and a task). Refuse with 503 above ~20 subscribers.
- **L8.4** Two regexes on job API fields are quadratic on input like `<<<<…` (`jobs/models.py` `_TAG`, `jobs/search.py` `_TITLE_NOISE`); harmless at API field sizes. Use `<[^<>]+>` and `\([^()]*\)|\[[^\[\]]*\]`.
- **N1** The fetcher can reach the owner's own public IP (NAT hairpin), so a port-forwarded service would be readable. Only matters with port forwards; a `WEB_BLOCKED_HOSTS` list checked in `guard.resolve_public` would close it. The address allowlist (H1) already keeps the model from choosing such an address.
- **L1 (rest)** The Next dev server now listens on 127.0.0.1 only, but its `/_next/*` cross-site check still only warns; `allowedDevOrigins: []` in `next.config.ts` would make it block.
- **L7 (rest)** GitHub Actions are pinned by tag, not commit SHA; Python dependencies have no lock file with hashes (transitive versions float); the venv's `setuptools` 65.5 and Python 3.11.9 are old (install-time and `ipaddress` fixes in 3.11.10+).
- **M2 / L1 (machine)** Windows Firewall has inbound rules for `node.exe` and Docker Desktop on the Public profile; with everything on loopback they are not needed by AI Office.

Load and resilience

- **P2 (rest)** Show in the server room when the loaded model does not fit in VRAM (`size_vram < size` in Ollama's `/api/ps`): generation then runs partly on the CPU and is many times slower.
- **P4** `GET /tasks` returns every task with its description and is refetched on every event; return active and recent ones only, and skip the refetch for `run` events.
- **P5** Task details return every run's full output and every artifact, and an open card refetches them about once a second while a stage streams; send the running stage's text separately.
- **P6** While streaming, the whole `runs.output` is rewritten every second (write amplification, WAL); save every 3–5 s or send the text over SSE and write at the end.
- **P7** SearXNG answers 200 with no results when its engines are blocked (CAPTCHA, rate limits): the agent sees "0 results", not "search unavailable". Treat `results: []` with `unresponsive_engines` as unavailable and show the engine names.
- **P9** Five periodic pollers; `/server-room` (which runs `nvidia-smi`) is re-fired by every `/state` refresh while its panel is open. Pause polling in a hidden tab, drop `lastUpdated` from that effect, cache the GPU reading for a few seconds.
- **P10** `logs/` is overwritten on every start and has no rotation; application INFO logs (e.g. "database reachable again") are not written at all. Append to dated files, delete old ones, configure `logging` with a rotating handler.
- **P12** `/state` loads whole `Run` rows (output included) for live runs; load only the columns it needs.
- **P13** Agents take turns on the single model slot, so each research turn may re-process the whole context (Ollama caches the previous prompt only). Consider letting a research stage keep the slot between quick tool calls.
- **P14** A retry keeps the GPU slot for the whole retry loop; release it between attempts.
- **P15** The frontend runs in `next dev` for daily use; `next build` + `next start -H 127.0.0.1` would use less CPU and memory.
- **P16** Chat requests set no `keep_alive`, so Ollama unloads the model after 5 idle minutes (start.ps1 preloads with 30 min) and the next stage pays the reload; the SSE client never reconnects after a non-200 answer (only polling remains); `JobSearch` cache entries are never evicted.
