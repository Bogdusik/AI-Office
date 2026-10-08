"""One vacancy in a shape shared by every source, and helpers to clean what the APIs send."""

import html
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

from app.jobs.freshness import EXPIRED, OPEN, RANK, UNCHECKED


class SourceError(Exception):
    """A job source failed. The message is short, safe to show and never contains a URL or a key."""


class SourceNotConfigured(SourceError):
    """The source has no API key in backend/.env."""


@dataclass
class Job:
    source: str
    """Where it came from first: `adzuna` or `reed`."""
    source_id: str
    title: str
    company: str
    location: str
    url: str
    description: str
    salary_min: float | None = None
    salary_max: float | None = None
    salary_note: str = ""
    """E.g. "per annum", "estimated" (Adzuna's predicted salaries)."""
    posted: date | None = None
    full: bool = False
    """`description` is the whole advert, not the snippet the search API returns."""
    links: dict[str, str] = field(default_factory=dict)
    """Every source that lists this vacancy → its link (duplicates merged across sources)."""
    ids: dict[str, str] = field(default_factory=dict)
    """Every source that lists this vacancy → its id there."""
    texts: list[str] = field(default_factory=list)
    """Every text seen for this vacancy (each listing's description, the full advert): the filter reads them all."""
    expires: date | None = None
    """Closing date from the source (Reed's `expirationDate`)."""
    freshness: str = UNCHECKED
    """`open`, `expired` or `unchecked`: is it still open, as far as a source's API or its advert page tells."""
    freshness_note: str = ""
    """How that was found out, or why it could not be."""

    def __post_init__(self) -> None:
        self.links = self.links or {self.source: self.url}
        self.ids = self.ids or {self.source: self.source_id}
        self.texts = self.texts or [self.description]

    @property
    def checked_text(self) -> str:
        """What the eligibility filter reads: the title and every text of every listing."""
        return "\n".join([self.title, *dict.fromkeys(t for t in (*self.texts, self.description) if t)])

    def mark(self, state: str, note: str) -> None:
        """Records what a source or the advert page says; stronger evidence wins (see `freshness.RANK`)."""
        if RANK[state] > RANK[self.freshness] or (state == self.freshness and note):
            self.freshness, self.freshness_note = state, note

    def dated(self, expires: date | None, source: str) -> None:
        """A closing date from a source's API: past → expired, otherwise open until then."""
        self.expires = expires or self.expires
        if self.expires is None:
            return
        if self.expires < date.today():
            self.mark(EXPIRED, f"closed on {self.expires.isoformat()} ({source} API)")
        else:
            self.mark(OPEN, f"open until {self.expires.isoformat()} ({source} API)")

    @property
    def salary(self) -> str:
        if self.salary_min is None and self.salary_max is None:
            return "not stated"
        low, high = self.salary_min or self.salary_max, self.salary_max or self.salary_min
        text = f"£{low:,.0f}" if low == high else f"£{low:,.0f}–£{high:,.0f}"
        return f"{text} ({self.salary_note})" if self.salary_note else text

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("texts")
        data["posted"] = self.posted.isoformat() if self.posted else None
        data["expires"] = self.expires.isoformat() if self.expires else None
        data["salary"] = self.salary
        return data


_BREAK = re.compile(r"<\s*(?:br|/p|/li|/h\d|/div)\s*/?\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def plain_text(value: object) -> str:
    """HTML fragments from the APIs → plain text with paragraph breaks kept."""
    text = _TAG.sub(" ", _BREAK.sub("\n", str(value or "")))
    lines = (" ".join(line.split()) for line in html.unescape(text).splitlines())
    return "\n".join(line for line in lines if line)


def number(value: object) -> float | None:
    try:
        result = float(str(value))
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None
