"""The backend speaks English: anything meant for the director goes out as a code the interface translates."""

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
CYRILLIC = re.compile(r"[Ѐ-ӿ]")


def test_no_cyrillic_in_the_backend_code() -> None:
    found = [
        f"{path.relative_to(APP.parent)}:{n}: {line.strip()}"
        for path in sorted(APP.rglob("*.py"))
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if CYRILLIC.search(line)
    ]
    assert found == []
