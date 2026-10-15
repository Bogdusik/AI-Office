# Security and load audit: summary

- **Date:** 2026-10-10. **Code reviewed:** `main` at `4dd8929`. **Fixes:** merged from `fix/audit` on 2026-10-13 (`f9a09ae`).
- **Reviewers:** two Claude Code subagents, `security-auditor` and `performance-engineer`, each run with a clean
  context and not the author of the code. The security pass was done twice; the second pass re-verified every finding
  and added N1 and N2. The load pass was stopped early by the owner, so it is not exhaustive. The author ran the
  subagents in Claude Code, sorted the findings by severity and wrote the fixes.
- **Threat model:** a local, single-user app with no login, running on the owner's PC. Attackers considered: a website
  open in the owner's browser, a device on the same LAN, and authors of the web pages and job adverts the agents read.
- **Scope of this file:** the outcome of each finding. The full report, with reproduction details, is kept out of the
  repository on purpose.

## Totals

| Severity | Findings | Fixed | Partly fixed | Open | Accepted risk |
|---|---|---|---|---|---|
| High | 6 | 4 | 2 | 0 | 0 |
| Medium | 9 | 4 | 0 | 5 | 0 |
| Low | 11 | 5 | 1 | 5 | 0 |
| Info | 7 | 1 | 1 | 4 | 1 |
| **Total** | **33** | **14** | **4** | **14** | **1** |

"Partly fixed" means the main issue is closed and a remainder is listed under [Open](#open). "Accepted risk" is
explained under [Accepted risk](#accepted-risk).

## Fixed

| ID | Severity | Finding | Fix | Covered by |
|---|---|---|---|---|
| H2 | High | Images in model output loaded automatically from any URL; no Content-Security-Policy | [`1853c2b`](https://github.com/Bogdusik/AI-Office/commit/1853c2b), [`dddf833`](https://github.com/Bogdusik/AI-Office/commit/dddf833) | `frontend/scripts/check-ui.mts` (`npm run check:ui`) |
| H3 | High | The API accepted any Host header, so a DNS-rebinding page could use it | [`386fee4`](https://github.com/Bogdusik/AI-Office/commit/386fee4) | `backend/tests/test_local_access.py` |
| P1 | High | A short Ollama outage failed every queued task | [`ba5dafa`](https://github.com/Bogdusik/AI-Office/commit/ba5dafa) | `backend/tests/test_ollama_outage.py` |
| P3 | High | The 3D scene rendered without a frame cap on the model's GPU | [`e227f03`](https://github.com/Bogdusik/AI-Office/commit/e227f03) | `frontend/scripts/check-ui.mts` (frame-rate limiter) |
| M1 | Medium | State-changing requests without a body were not protected against cross-site requests | [`386fee4`](https://github.com/Bogdusik/AI-Office/commit/386fee4) | `backend/tests/test_local_access.py` |
| M3 | Medium | Page-title parsing could block the event loop on large untrusted HTML | [`23791ee`](https://github.com/Bogdusik/AI-Office/commit/23791ee) | `backend/tests/test_fetch_limits.py` |
| L4 | Medium | Decompression of fetched pages was unbounded | [`23791ee`](https://github.com/Bogdusik/AI-Office/commit/23791ee) | `backend/tests/test_fetch_limits.py` |
| P8 | Medium | No daily budget for the shared Adzuna and Reed keys | [`205d039`](https://github.com/Bogdusik/AI-Office/commit/205d039) | `backend/tests/test_job_limits.py` |
| M2 | Low | PostgreSQL was published on all interfaces | [`386fee4`](https://github.com/Bogdusik/AI-Office/commit/386fee4), [`706cf1e`](https://github.com/Bogdusik/AI-Office/commit/706cf1e) | `backend/tests/test_local_access.py` |
| M4 | Low | No backup of the only copy of the data | [`3b15f9f`](https://github.com/Bogdusik/AI-Office/commit/3b15f9f) | `backend/tests/test_backup_script.py` |
| L2 | Low | Untrusted page titles and job fields went into code-built Markdown unescaped | [`80b619c`](https://github.com/Bogdusik/AI-Office/commit/80b619c) | `backend/tests/test_markdown_escaping.py` |
| L3 | Low | Data-tag escaping was case-sensitive | [`80b619c`](https://github.com/Bogdusik/AI-Office/commit/80b619c) | `backend/tests/test_markdown_escaping.py` |
| P11 | Low | Page text extraction ran synchronously on the event loop | [`23791ee`](https://github.com/Bogdusik/AI-Office/commit/23791ee) | `backend/tests/test_fetch_limits.py` |
| N2 | Info | The interactive API docs loaded third-party scripts into the API's origin | [`523bfde`](https://github.com/Bogdusik/AI-Office/commit/523bfde) | `backend/tests/test_supply_chain.py` |

## Partly fixed

| ID | Severity | What was fixed | What is left |
|---|---|---|---|
| H1 | High | The research stage no longer sees the director's profile, opens only addresses from the task, search results or job APIs, and refuses search queries containing profile details ([`1eea8d1`](https://github.com/Bogdusik/AI-Office/commit/1eea8d1), `backend/tests/test_research_privacy.py`) | Links that later stages write into a result are not yet checked for profile details |
| P2 | High | Stages wait for Ollama instead of failing, continue from the text already written and time out only on a silent stream ([`ba5dafa`](https://github.com/Bogdusik/AI-Office/commit/ba5dafa), `backend/tests/test_ollama_outage.py`) | No warning yet when the loaded model does not fit in GPU memory |
| L1 | Low | The Next.js dev server listens on 127.0.0.1 only ([`386fee4`](https://github.com/Bogdusik/AI-Office/commit/386fee4)) | Its cross-site check still only warns |
| L7 | Info | The SearXNG image is pinned by tag and digest ([`523bfde`](https://github.com/Bogdusik/AI-Office/commit/523bfde), `backend/tests/test_supply_chain.py`) | GitHub Actions pinned by tag, not SHA; no hashed Python lock file |

## Open

Planned; each has an entry in [`backlog.md`](backlog.md) under "Audit leftovers".

| ID | Severity | Finding |
|---|---|---|
| P4 | Medium | The task list is unbounded and refetched on every event |
| P5 | Medium | Task details return every run's output and are refetched while a stage streams |
| P6 | Medium | Streaming rewrites the whole run output every second |
| P7 | Medium | Blocked search engines look like "no results" to the agent |
| P9 | Medium | Several periodic pollers; the server-room panel is refetched too often |
| P10 | Low | Logs are overwritten on each start and have no rotation |
| P12 | Low | The state snapshot loads whole run rows for live runs |
| P13 | Low | Interleaved agents may defeat Ollama's prompt cache (estimate, not measured) |
| P14 | Low | A retry holds the GPU slot for the whole retry loop |
| P15 | Low | The frontend runs on the dev server for daily use |
| L5 | Info | Text fields have no length limit |
| L6 | Info | The Ollama client follows system proxy settings |
| L8 | Info | Small items: raw exception text in task cards, no cap on event streams, two regexes worth tightening |
| P16 | Info | Model keep-alive, event-stream reconnection and cache eviction |

## Accepted risk

| ID | Severity | Finding | Why accepted |
|---|---|---|---|
| N1 | Info | The page fetcher can reach the owner's own public IP address | Only matters if the owner forwards ports to this PC; the fetcher already opens only addresses from the task, search results or job APIs |

Also accepted, outside the code: Windows Firewall inbound rules for Node.js and Docker Desktop that remain from earlier
use (part of M2 and L1). With every service bound to the loopback, AI Office does not need them; removing them is a
machine setting, not a change to this repository.
