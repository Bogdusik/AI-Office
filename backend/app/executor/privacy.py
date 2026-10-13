"""Personal details from the director profile that must not leave the machine in a search query.

Research runs without the profile, but the plan it gets may repeat a detail, and search queries go out to
SearXNG's engines and the job APIs. Before every search the query is checked against these terms; a term the
task itself contains is needed for the task and stays allowed.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.executor.worker import ProfileSnapshot


@dataclass(frozen=True)
class PrivateTerm:
    text: str
    kind: str
    """name | contact | link | project"""


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"\+?\d[\d\s().-]{6,}\d")
_URL = re.compile(r"(https?://|www\.)?((?:[a-z0-9-]+\.)+([a-z]{2,}))(/[^\s,;)]*)?", re.IGNORECASE)
_SITE_TLDS = {"com", "org", "net", "dev", "me", "co", "uk", "app", "page", "site", "info", "xyz", "tech", "ai", "eu", "ua", "ru"}
"""A bare `name.tld` counts as a link only with one of these; `Next.js` or `socket.io` are technologies, not sites."""
_QUOTED = re.compile(r"[\"“«]([^\"”»\n]{3,60})[\"”»]")
_PROJECT = re.compile(r"\b(?:projects?|apps?|portfolio|\u043f\u0440\u043e\u0435\u043a\u0442\u044b?|\u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432)\b\s*(?::|—|-|called|named)?\s*([^.;\n]*)", re.IGNORECASE)
_PARENS = re.compile(r"\([^)]*\)")
_NAME_PART = re.compile(r"[^\W\d_]{3,}")
_DIGITS = re.compile(r"\D")
_WORDS = re.compile(r"[\w.+-]+")
_STOP = {"and", "the", "for", "with"}


def _digits(text: str) -> str:
    return _DIGITS.sub("", text)


def _phone_key(text: str) -> str:
    """The last nine digits: the same number written as +44 7700 900123 or 07700 900123."""
    return _digits(text)[-9:]


def _project_names(chunk: str) -> list[str]:
    """`Projects: SearchWork (job tracker), Programming Helper AI and Chat App` → the capitalised name at the start
    of each listed item."""
    names = []
    for part in re.split(r",\s*|\s+and\s+|\s+\u0438\s+", _PARENS.sub(" ", chunk)):
        words: list[str] = []
        for word in _WORDS.findall(part):
            if not word[:1].isupper():
                break
            words.append(word)
        if words and len(" ".join(words)) >= 3:
            names.append(" ".join(words))
    return names


def private_terms(profile: ProfileSnapshot, task_text: str) -> list[PrivateTerm]:
    """What counts as private in this profile, minus anything the task itself mentions."""
    text = "\n".join((profile.name, profile.summary, profile.goal, profile.constraints, profile.notes))
    found: list[PrivateTerm] = []
    name = " ".join(profile.name.split())
    if name:
        found.append(PrivateTerm(name, "name"))
        found += [PrivateTerm(part, "name") for part in _NAME_PART.findall(name) if part.lower() not in _STOP]
    emails = _EMAIL.findall(text)
    found += [PrivateTerm(e, "contact") for e in emails]
    found += [PrivateTerm(p.strip(), "contact") for p in _PHONE.findall(text) if len(_digits(p)) >= 7]
    for m in _URL.finditer(text):
        prefix, host, tld, path = m.groups()
        if any(m.group(0) in e for e in emails) or not (prefix or path or tld.lower() in _SITE_TLDS):
            continue
        link = (host + (path or "")).rstrip("/.")
        found.append(PrivateTerm(link, "link"))
        handle = urlsplit(f"//{link}").path.strip("/").split("/")[-1]
        if len(handle) >= 3:
            found.append(PrivateTerm(handle, "link"))
    found += [PrivateTerm(q.strip(), "project") for q in _QUOTED.findall(text)]
    for chunk in _PROJECT.findall(text):
        found += [PrivateTerm(n, "project") for n in _project_names(chunk)]

    task = task_text.lower()
    task_digits = _digits(task_text)
    unique: dict[str, PrivateTerm] = {}
    for term in found:
        key = term.text.lower()
        phone = term.kind == "contact" and "@" not in key
        needed = (_phone_key(key) in task_digits) if phone else key in task
        if key and not needed and key not in unique:
            unique[key] = term
    return list(unique.values())


def leaked(query: str, terms: list[PrivateTerm]) -> list[PrivateTerm]:
    """Terms the query contains (whole words, any case; phone numbers by their last nine digits)."""
    low = query.lower()
    digits = _digits(query)
    hits = []
    for term in terms:
        key = term.text.lower()
        if term.kind == "contact" and "@" not in key:
            if len(_phone_key(key)) >= 7 and _phone_key(key) in digits:
                hits.append(term)
        elif re.search(rf"(?<!\w){re.escape(key)}(?!\w)", low):
            hits.append(term)
    return hits
