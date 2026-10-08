# Backlog

Ideas parked for later stages. Don't implement before their stage.

## Agent tools (after stage 6)

- `search_jobs` tool for the `job_search` agent: query a jobs API (Adzuna, Reed, or my own SearchWork project) and get structured vacancies (title, company, location, salary, link) instead of reading job-board pages, which often block bots (403) or render in JS.

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
