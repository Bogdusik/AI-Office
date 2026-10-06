import asyncio

from app.db.session import SessionLocal, engine
from app.seed.runner import run_seed


async def main() -> None:
    async with SessionLocal() as session:
        report = await run_seed(session)
    await engine.dispose()
    print(f"created: {', '.join(report.created) or '-'}")
    print(f"skipped: {', '.join(report.skipped) or '-'}")


if __name__ == "__main__":
    asyncio.run(main())
