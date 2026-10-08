import argparse
import asyncio
import sys

from app.db.session import SessionLocal, engine
from app.seed.demo import DemoRefused, run_demo
from app.seed.runner import run_seed


async def main(demo: bool) -> int:
    try:
        async with SessionLocal() as session:
            report = await (run_demo(session) if demo else run_seed(session))
    except DemoRefused as exc:
        print(exc, file=sys.stderr)
        return 1
    finally:
        await engine.dispose()
    print(f"created: {', '.join(report.created) or '-'}")
    print(f"skipped: {', '.join(report.skipped) or '-'}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="python -m app.seed", description="Seed the office: floors and agents.")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="also fill an empty database with a fictional director and a few finished tasks",
    )
    sys.exit(asyncio.run(main(parser.parse_args().demo)))
