"""backup.ps1: a dated copy of the database outside the project, the latest N kept, an optional mirror (audit M4).

Runs on Windows with the database container up (the project's normal setup); skipped elsewhere, e.g. in CI.
"""

import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.core.config import get_settings

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "backup.ps1"


def _container_up() -> bool:
    if os.name != "nt" or shutil.which("docker") is None:
        return False
    out = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", "ai-office-db"], capture_output=True, text=True)
    return out.returncode == 0 and out.stdout.strip() == "true"


pytestmark = pytest.mark.skipif(not _container_up(), reason="needs Windows and the ai-office-db container")


def backup(*args: str) -> subprocess.CompletedProcess[str]:
    database = make_url(get_settings().test_database_url).database or ""
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), "-Database", database, *args],
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_copies_are_dated_readable_kept_to_the_limit_and_mirrored(tmp_path: Path) -> None:
    main, mirror = tmp_path / "backups", tmp_path / "onedrive"
    for i in range(5):
        if i:
            time.sleep(1.1)  # names carry the time to the second
        done = backup("-Dir", str(main), "-MirrorDir", str(mirror), "-Keep", "3")
        assert done.returncode == 0, done.stdout + done.stderr

    for folder in (main, mirror):
        files = sorted(folder.glob("*.dump"))
        assert len(files) == 3, files
        assert all(f.read_bytes()[:5] == b"PGDMP" for f in files)
    assert [f.name for f in sorted(main.glob("*.dump"))] == [f.name for f in sorted(mirror.glob("*.dump"))]
    newest = sorted(main.glob("*.dump"))[-1].name
    assert newest.split("-", 1)[1][:8] == time.strftime("%Y%m%d")


def test_a_folder_inside_the_project_is_refused(tmp_path: Path) -> None:
    done = backup("-Dir", str(ROOT / "backups"))
    assert done.returncode != 0 and "inside the project" in done.stdout
    assert not (ROOT / "backups").exists()
