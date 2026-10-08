"""Demo mode: a fictional director and a few finished tasks, so the office can be shown without anyone's real data.

`python -m app.seed --demo` refuses to touch a database that already has a filled-in profile or any task; on an
empty one it runs the regular seed, fills the profile and adds the tasks below with their results. Runs are marked
provider `fake` with no token counts, so the server room's usage numbers stay real. Two tasks are left in the
queue: the executor (fake or a real model) starts on them as soon as the backend runs.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PROFILE_ID, Agent, Artifact, Profile, Run, Task, TaskComment
from app.models.enums import AgentStatus, CommentAuthor, RunProvider, RunStatus, TaskStage, TaskStatus
from app.seed.runner import SeedReport, run_seed
from app.services import rules

PROFILE = {
    "name": "Alex Carter",
    "summary": (
        "Junior backend developer (a fictional demo profile). BSc Computer Science, 2026. Built a bookshop API with "
        "FastAPI, async SQLAlchemy and PostgreSQL, plus a small Next.js dashboard for it. Sends documentation and "
        "test fixes to open-source Python libraries."
    ),
    "goal": "Land a first backend or platform engineering role in the UK within six months.",
    "constraints": (
        "Based in Leeds; hybrid in the North of England or fully remote. Available from January 2027. "
        "About 10 hours a week for applications and side projects."
    ),
    "notes": "This profile is fictional and exists only for the AI Office demo.",
}


class DemoRefused(Exception):
    """The database already holds someone's data; nothing was changed."""


@dataclass(frozen=True)
class DemoVersion:
    result: str
    comment: str = ""
    """The director's comment on this version, asking for the next one."""
    sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class DemoTask:
    role_key: str
    title: str
    description: str
    status: TaskStatus
    days_ago: float
    versions: tuple[DemoVersion, ...] = ()


SHORTLIST = """\
# Shortlist: junior backend roles in Leeds and Manchester

> Demo data: the companies and links below are fictional.

| # | Company | Role | Location | Salary | Closes | Fit |
|---|---------|------|----------|--------|--------|-----|
| 1 | Kestrel Payments | Junior Python Engineer | Leeds, hybrid (2 days) | £32–36k | 24 Oct | FastAPI + PostgreSQL, the bookshop API stack |
| 2 | Northwind Logistics | Graduate Backend Developer | Manchester, hybrid | £30k | 31 Oct | Async Python, event-driven; strong mentoring |
| 3 | Brightline Health | Associate Software Engineer | Remote (UK) | £31–34k | 7 Nov | Django, FastAPI listed as a plus |
| 4 | Fernhill Analytics | Junior Data Platform Engineer | Leeds | £33k | 14 Nov | SQL-heavy, less API work |
| 5 | Copperleaf Games | Backend Developer (Entry) | Manchester | £29k | rolling | Go and Python; on site 4 days |

## Why this order
- **Kestrel** asks for exactly the stack of the bookshop API and hires juniors every autumn.
- **Northwind** runs a structured graduate scheme, which suits a first role.
- **Copperleaf** is last: four days on site is outside your constraints.

## Red flags checked
- None of the five is sponsorship-only or unpaid.
- Fernhill lists "3+ years with Airflow" under nice-to-haves only: apply anyway.

## Next actions
1. Tailor the CV summary for Kestrel: lead with async SQLAlchemy.
2. Ask Harper for a short cover letter for Northwind.
3. Set reminders for the 24 Oct and 31 Oct deadlines.

## Sources
- https://example.com/jobs/kestrel-junior-python
- https://example.com/jobs/northwind-graduate-backend
- https://example.com/jobs/brightline-associate-engineer"""

REVIEW = """\
# Review: async session handling in the bookshop API

> Demo data: the project and its code are fictional.

## Findings, most severe first

### 1. High: one session shared by all requests (`app/db.py:14`)
A module-level `AsyncSession` is created once and reused. Concurrent requests interleave their transactions,
and one request's rollback discards another's writes.
**Fix:** a `get_db` dependency that yields one session per request from `async_sessionmaker`.

### 2. High: the stock check and the order insert are not atomic (`app/routers/orders.py:41`)
Stock is read, checked in Python, then decremented by a second statement: two buyers can both get the last copy.
**Fix:** `SELECT ... FOR UPDATE` on the book row in the same transaction, or one
`UPDATE books SET stock = stock - 1 WHERE id = :id AND stock > 0 RETURNING stock`.

### 3. Medium: responses built from expired objects (`app/routers/orders.py:58`)
With `expire_on_commit=True`, reading attributes after `commit()` triggers lazy loads, which fail in async code
(`MissingGreenlet`).
**Fix:** `async_sessionmaker(engine, expire_on_commit=False)`.

### 4. Low: the engine is created at import time (`app/db.py:6`)
Tests cannot point the app at a separate database.
**Fix:** build the engine from settings in the FastAPI lifespan.

## What is good
- Pydantic schemas are kept apart from the ORM models.
- Every endpoint sets `status_code` explicitly.

## Suggested order
Fix 1 and 2 in one PR with a concurrency test, then 3; 4 can wait."""

OUTLINE = """\
# Shipping my first FastAPI project: five things I got wrong

**TL;DR:** a small bookshop API taught me more about sessions, transactions and testing than any tutorial.
Five mistakes, how they showed up, and the fixes, with code.

**Tags:** #python #fastapi #postgresql #beginners

## Outline

1. **Why a bookshop?** Stock, orders and payments force real concurrency problems early.
2. **Mistake 1: one database session for the whole app.**
   Symptom: random rollbacks under load. Fix: a session per request with a `get_db` dependency (8-line snippet).
3. **Mistake 2: checking stock in Python.**
   Reproduce "two buyers, one book" with `asyncio.gather` in a test. Fix: `UPDATE ... WHERE stock > 0 RETURNING`.
4. **Mistake 3: testing against SQLite.**
   `FOR UPDATE` and JSONB behaved differently. Fix: a throwaway Postgres database per test session.
5. **Mistake 4: changing the schema by hand.** Fix: Alembic from day one; read every generated migration.
6. **Mistake 5: no logs around external calls.** Fix: structured logs with a request id.
7. **What I would do differently.** Start with the test database and the session dependency; the rest gets easier.

## Questions for you
- Can I quote the load test numbers (about 40 requests per second on a laptop), or keep it qualitative?
- Should the article link the repository, or is it still private?"""

PLAN_V1 = """\
# 12-week plan (version 1)

## Tracks
1. **Applications:** 8 tailored applications a week.
2. **Bookshop API:** finish payments and deploy it.
3. **Second project:** a log-analysis CLI in Go.
4. **Open source:** one documentation or test PR a week.

## Weekly rhythm (about 20 hours)
- Mon–Tue: applications (6 h)
- Wed–Thu: bookshop API (8 h)
- Fri: Go project (4 h)
- Weekend: open source (2 h)

## Milestones
- Week 2: bookshop API deployed.
- Week 6: Go CLI v0.1 released.
- Week 12: 90+ applications sent, 5+ interviews."""

PLAN_V2 = """\
# 12-week plan (version 2)

> Changes from version 1: about 10 hours a week, the Go project is dropped, three tracks instead of four.

## Tracks
1. **Applications:** 4 tailored applications a week, quality over volume.
2. **Bookshop API:** the portfolio centrepiece; payments, tests, deployment.
3. **Interview practice:** one mock interview a week with Riley.

## Weekly rhythm (about 10 hours)
| Day | Hours | Focus |
|-----|-------|-------|
| Mon | 2 | Applications: research and tailoring |
| Wed | 3 | Bookshop API |
| Thu | 1 | Mock interview and notes |
| Sat | 4 | Bookshop API, or a second round of applications |

## Milestones
- **Week 3:** bookshop API deployed with a public README.
- **Week 6:** 24 applications sent; review the response rate and adjust the CV.
- **Week 9:** concurrency tests merged, the HackerNoon article published.
- **Week 12:** 48 applications, at least 3 interviews.

## Dropped on purpose
- The Go CLI: a second half-finished project weakens the portfolio more than it helps.

## Next three actions
1. Block the four time slots in the calendar.
2. Ask Jordan for this week's shortlist.
3. Write the deployment checklist for the bookshop API."""

TASKS: tuple[DemoTask, ...] = (
    DemoTask(
        role_key="goals_strategist",
        title="Plan for the next 12 weeks",
        description="Turn my goal into a 12-week plan with weekly milestones and the next three actions.",
        status=TaskStatus.DONE,
        days_ago=5,
        versions=(
            DemoVersion(
                PLAN_V1,
                comment="Too ambitious: I have about 10 hours a week. Drop the second project and keep three tracks.",
            ),
            DemoVersion(PLAN_V2),
        ),
    ),
    DemoTask(
        role_key="job_search",
        title="Shortlist: junior backend roles in Leeds and Manchester",
        description="Find 5 junior or graduate backend roles (Python preferred) in Leeds, Manchester or remote UK. "
        "Rank them by fit with my profile.",
        status=TaskStatus.DONE,
        days_ago=3,
        versions=(
            DemoVersion(
                SHORTLIST,
                sources=(
                    "https://example.com/jobs/kestrel-junior-python",
                    "https://example.com/jobs/northwind-graduate-backend",
                    "https://example.com/jobs/brightline-associate-engineer",
                ),
            ),
        ),
    ),
    DemoTask(
        role_key="code_reviewer",
        title="Review: async session handling in the bookshop API",
        description="Review how the bookshop API opens and closes SQLAlchemy async sessions (app/db.py and the "
        "orders router). Look for leaks and race conditions.",
        status=TaskStatus.DONE,
        days_ago=2,
        versions=(DemoVersion(REVIEW),),
    ),
    DemoTask(
        role_key="hackernoon_writer",
        title="Article outline: shipping my first FastAPI project",
        description="Outline a HackerNoon article about building the bookshop API: what went wrong and what I "
        "would do differently. Practical, no hype.",
        status=TaskStatus.NEEDS_REVIEW,
        days_ago=0.1,
        versions=(DemoVersion(OUTLINE),),
    ),
    DemoTask(
        role_key="interview_coach",
        title="Mock interview: 8 backend questions with model answers",
        description="Questions for a junior Python backend role: HTTP, databases, async, testing and one "
        "behavioural question. Base the model answers on the bookshop API.",
        status=TaskStatus.QUEUED,
        days_ago=0,
    ),
    DemoTask(
        role_key="portfolio_evidence",
        title="Evidence log: what I shipped this month",
        description="Log this month's public achievements (open-source PRs, the article draft, the deployed API) "
        "in the usual format and say what is missing.",
        status=TaskStatus.QUEUED,
        days_ago=0,
    ),
)


def _stage_output(stage: TaskStage, task: DemoTask, result: str) -> str:
    match stage:
        case TaskStage.PLAN:
            return (
                f"Plan for «{task.title}» (demo data, no model was run):\n"
                "1. Read the task and the director's profile.\n2. Collect the facts the result needs.\n"
                "3. Write the draft and check it against the task."
            )
        case TaskStage.RESEARCH:
            return "Research (demo data): no web search was run; the links in the result are placeholders."
        case _:
            return result


async def _filled(session: AsyncSession) -> str | None:
    profile = await session.get(Profile, PROFILE_ID)
    if profile is not None and any((profile.name, profile.summary, profile.goal, profile.constraints, profile.notes)):
        return "the director's profile is already filled in"
    if await session.scalar(select(func.count()).select_from(Task)):
        return "the database already has tasks"
    return None


async def run_demo(session: AsyncSession, at: datetime | None = None) -> SeedReport:
    reason = await _filled(session)
    if reason is not None:
        raise DemoRefused(f"Demo data goes into an empty database only: {reason}. Nothing was changed.")
    report = await run_seed(session)
    at = at or datetime.now(UTC)

    profile = await session.get_one(Profile, PROFILE_ID)
    for key, value in PROFILE.items():
        setattr(profile, key, value)
    report.created.append("demo profile")

    agents = {
        a.role_key: a
        for a in (await session.scalars(select(Agent).where(Agent.archived_at.is_(None)))).all()
    }
    positions: dict[int, int] = {}
    for spec in TASKS:
        agent = agents.get(spec.role_key)
        if agent is None:
            report.skipped.append(f"demo task for {spec.role_key} (no such agent)")
            continue
        positions[agent.id] = positions.get(agent.id, 0) + 1
        created = at - timedelta(days=spec.days_ago)
        task = Task(
            agent_id=agent.id,
            title=spec.title,
            description=spec.description,
            status=spec.status,
            position=positions[agent.id],
            created_at=created,
        )
        session.add(task)
        await session.flush()

        t = created + timedelta(minutes=2)
        if spec.versions:
            task.started_at = t
        for version, demo in enumerate(spec.versions, start=1):
            for stage in rules.task_stages(web_access=agent.web_access, version=version, tools=agent.tools):
                session.add(
                    Run(
                        task_id=task.id,
                        stage=stage,
                        attempt=version,
                        provider=RunProvider.FAKE,
                        status=RunStatus.SUCCEEDED,
                        output=_stage_output(stage, spec, demo.result),
                        sources=list(demo.sources) if stage == TaskStage.SELF_CHECK else [],
                        started_at=t,
                        finished_at=t + timedelta(minutes=1),
                    )
                )
                task.stage = stage
                t += timedelta(minutes=1)
            session.add(
                Artifact(task_id=task.id, version=version, content=demo.result, sources=list(demo.sources), created_at=t)
            )
            if demo.comment:
                t += timedelta(minutes=30)
                session.add(TaskComment(task_id=task.id, author=CommentAuthor.DIRECTOR, body=demo.comment, created_at=t))
                t += timedelta(minutes=1)
        if spec.status == TaskStatus.DONE:
            task.finished_at = t + timedelta(hours=1)
        if spec.status == TaskStatus.NEEDS_REVIEW:
            agent.set_status(AgentStatus.WAITING_REVIEW, at)
        report.created.append(f"demo task '{spec.title}' ({spec.status})")

    await session.commit()
    return report
