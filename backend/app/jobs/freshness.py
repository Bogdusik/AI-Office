"""Is a vacancy still open? Only what a source's API or the advert page says; anything else stays `unchecked`.

Sites that refuse automated requests (HTTP 401/403/429) are not worked around: the vacancy stays `unchecked`
with that reason, and the result says so.
"""

import re

OPEN = "open"
EXPIRED = "expired"
UNCHECKED = "unchecked"
RANK = {UNCHECKED: 0, OPEN: 1, EXPIRED: 2}
"""Stronger evidence wins when listings are merged: closed anywhere > open somewhere > not checked."""

GONE = frozenset({404, 410})
REFUSED = frozenset({401, 403, 429})

_THING = r"(?:job|vacancy|position|role|advert|posting|listing)"
CLOSED = re.compile(
    "|".join(
        [
            rf"\b(?:this|the)\s+{_THING}\s+(?:has\s+(?:now\s+)?|is\s+(?:now\s+)?)(?:expired|closed|been\s+filled|no\s+longer\s+(?:available|active|open|advertised|live|accepting\s+applications))\b",
            r"\bjob\s+(?:has\s+)?expired\b",
            r"\bno\s+longer\s+accepting\s+applications\b(?!\s+(?:from|via|through))",
            rf"\bapplications\s+(?:for\s+this\s+{_THING}\s+)?(?:are|have)\s+(?:now\s+)?closed\b",
            r"\bthe\s+closing\s+date\s+(?:for\s+this\s+\w+\s+)?has\s+(?:now\s+)?passed\b",
        ]
    ),
    re.IGNORECASE,
)


def closed_phrase(text: str) -> str | None:
    """The phrase that says an advert page is closed ("This job has expired"), or None."""
    match = CLOSED.search(text)
    return " ".join(match.group(0).split()) if match else None


def refused(status: int | None) -> str:
    return f"the site does not let automated requests in (HTTP {status}); not worked around"
