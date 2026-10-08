"""Hard eligibility filter: requirements the director cannot meet, checked in code, never left to the model.

A vacancy is not eligible when its text asks for
- a security clearance that comes with a UK residency condition (SC, DV, NPPV, CTC and the like),
- a number of years of UK residency,
- a nationality or citizenship requirement (UK national since birth, British citizens only and the like).

Basic checks (BPSS, baseline, background or pre-employment checks) are not a reason on their own.
The abbreviations count only next to clearance words ("SC clearance", "SC cleared", "DV vetting"), never as two
letters anywhere ("SC Johnson", "DV360"). A sentence that says the requirement is not needed does not count.

Every phrase lives in `RULES`; tests in `tests/test_eligibility.py` cover real wording, both ways.
"""

import re
from collections import Counter
from dataclasses import dataclass

CLEARANCE = "security clearance with a UK residency condition (SC/DV/NPPV)"
RESIDENCY = "years of UK residency required"
NATIONALITY = "nationality or citizenship requirement"

_LEVEL = r"(?:SC|DV|eDV|NPPV\s*-?\s*[1-3]?|CTC)"
_CLEARED = r"(?:clearance|cleared|clearable|vetting|vetted|level|eligible|eligibility)"
_YEARS = r"(?:\d{1,2}|three|four|five|six|seven|eight|nine|ten)\+?(?:\s*\(\s*\d{1,2}\s*\))?"
_UK = r"(?:the\s+)?(?:UK|U\.K\.|United\s+Kingdom|Great\s+Britain|Britain)"
_BRITISH = r"(?:British|UK|U\.K\.)"

RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    # SC clearance · SC-cleared · DV vetting · NPPV3 vetted · SC eligible · CTC clearance
    (CLEARANCE, re.compile(rf"\b{_LEVEL}\s*[-/]?\s*(?:security\s+)?{_CLEARED}\b", re.IGNORECASE)),
    # clearance (SC) · cleared to SC level · vetting: DV · security clearance at DV
    (CLEARANCE, re.compile(rf"\b(?:clearance|cleared|vetting|vetted)\s*(?:level\s*)?[(:\-]?\s*(?:to|at)?\s*{_LEVEL}\b(?!\s*Johnson)", re.IGNORECASE)),
    # Security Check (SC) · security check clearance · Security Check level (the official name, not a generic check)
    (CLEARANCE, re.compile(r"\bsecurity\s+check(?:ed)?\s*(?:\(\s*SC\s*\)|clearance|cleared|level|vetting)", re.IGNORECASE)),
    (CLEARANCE, re.compile(r"\bSecurity\s+Check\b")),
    # eligible for SC · eligibility for DV (the level right after it)
    (CLEARANCE, re.compile(rf"\b(?:eligible|eligibility)\s+(?:for|to\s+(?:obtain|hold|gain))\s+{_LEVEL}\b(?!\s+(?:support|services?|refuges?|victims?))", re.IGNORECASE)),
    # developed vetting · counter-terrorist check · non-police personnel vetting
    (CLEARANCE, re.compile(r"\b(?:enhanced\s+)?developed\s+vetting\b|\bcounter[\s-]+terroris[tm]\s+check\b|\bnon[\s-]+police\s+personnel\s+vetting\b", re.IGNORECASE)),
    # eligible for / able to obtain security clearance · active security clearance · security clearance is required
    (CLEARANCE, re.compile(r"\b(?:eligible|eligibility|able|willing)\s+(?:for|to\s+(?:obtain|gain|achieve|hold|get|undergo))\s+(?:UK\s+|government\s+)?security\s+clearance\b", re.IGNORECASE)),
    (CLEARANCE, re.compile(r"\b(?:active|current|valid|existing|live)\s+(?:UK\s+|government\s+)?security\s+clearance\b", re.IGNORECASE)),
    (CLEARANCE, re.compile(r"\bsecurity\s+clearance\s+(?:is\s+)?(?:required|essential|mandatory|needed)\b", re.IGNORECASE)),
    # 5 years UK residency · five (5) years' residency · 10 years of continuous UK residence
    (RESIDENCY, re.compile(rf"\b{_YEARS}\s*years?['’]?\s+(?:of\s+)?(?:continuous\s+|permanent\s+|consecutive\s+)?(?:{_UK}\s+)?residen(?:cy|ce)\b", re.IGNORECASE)),
    # resident in the UK for the last 5 years · lived in the UK continuously for at least ten years
    (RESIDENCY, re.compile(rf"\b(?:resident|residing|lived|living|reside)\s+in\s+{_UK}\s+(?:continuously\s+)?for\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?(?:the\s+)?(?:last|past|previous)?\s*{_YEARS}\s*years?\b", re.IGNORECASE)),
    # UK residency for the last 5 years · residency in the UK of at least 5 years
    (RESIDENCY, re.compile(rf"\b(?:{_UK}\s+)?residen(?:cy|ce)\s+(?:in\s+{_UK}\s+)?(?:for|of)\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?(?:the\s+)?(?:last|past|previous)?\s*{_YEARS}\s*years?\b", re.IGNORECASE)),
    # UK national since birth · British nationals from birth
    (NATIONALITY, re.compile(rf"\b{_BRITISH}\s+(?:nationals?|citizens?)\s+(?:since|from)\s+birth\b", re.IGNORECASE)),
    # sole British national · sole UK nationality
    (NATIONALITY, re.compile(rf"\bsole\s+{_BRITISH}\s+national(?:ity|s)?\b", re.IGNORECASE)),
    # British citizens only · UK nationals only · British passport holders only
    (NATIONALITY, re.compile(rf"\b{_BRITISH}\s+(?:citizens?|nationals?|passport\s+holders?)\s+only\b", re.IGNORECASE)),
    # only open to British citizens · open only to UK nationals
    (NATIONALITY, re.compile(rf"\b(?:only\s+(?:open\s+)?to|open\s+only\s+to|restricted\s+to|limited\s+to)\s+{_BRITISH}\s+(?:citizens?|nationals?)\b", re.IGNORECASE)),
    # must be a British citizen · must hold British nationality (but not "a British citizen or ..." alternatives)
    (NATIONALITY, re.compile(rf"\bmust\s+(?:be|hold|have)\s+(?:a\s+)?{_BRITISH}\s+(?:citizen|national|citizenship|nationality)\b(?!\s*(?:,|/|or\b|and/or\b))", re.IGNORECASE)),
    # British citizenship is required · UK nationality essential
    (NATIONALITY, re.compile(rf"\b{_BRITISH}\s+(?:citizenship|nationality)\s+(?:is\s+)?(?:required|essential|mandatory)\b", re.IGNORECASE)),
    # dual nationals are not eligible · no dual nationals
    (NATIONALITY, re.compile(r"\bdual\s+nationals?\s+(?:are\s+|will\s+)?not\s+(?:be\s+)?(?:eligible|accepted|considered)\b|\bno\s+dual\s+nationals?\b", re.IGNORECASE)),
)

NEGATION = re.compile(
    r"\b(?:not|isn['’]t|aren['’]t)\s+(?:a\s+)?(?:required|needed|necessary|essential|mandatory|a\s+requirement)\b"
    r"|\bno\s+(?:need|requirement)\b"
    r"|\b(?:does|do)\s+not\s+(?:require|need)\b|\b(?:doesn['’]t|don['’]t)\s+(?:require|need)\b"
    r"|\bno\s+(?:\w+\s+){0,2}(?:clearance|vetting)\s+(?:is\s+)?(?:required|needed|necessary)\b"
    r"|\bwithout\s+(?:the\s+)?need\b",
    re.IGNORECASE,
)
DIRECTOR_NEGATION = re.compile(
    r"\b(?:skip|avoid|exclude|excluding|except|ignore|filter\s+out|leave\s+out|without)\b"
    r"|\b(?:i|we)\s+(?:don['’]t|do\s+not|can['’]t|cannot|won['’]t)\b|\b(?:don['’]t|do\s+not)\s+(?:have|hold|show|include|want)\b"
    r"|\bno\s+(?:roles?|jobs?|vacancies|positions?)\b",
    re.IGNORECASE,
)
"""In the director's own words (a search request) these turn a requirement into "leave such jobs out"."""
BASIC_CHECK = re.compile(r"\b(?:BPSS|baseline|background|basic|pre[\s-]?employment)\b[\s\w/()-]{0,25}$", re.IGNORECASE)
SENTENCE_END = re.compile(r"[.!?;\n]")


@dataclass(frozen=True)
class Exclusion:
    reason: str
    phrase: str
    """The words that matched, as written in the advert."""


def _sentence(text: str, start: int, end: int) -> str:
    left = max((m.end() for m in SENTENCE_END.finditer(text, 0, start)), default=0)
    right = next((m.start() for m in SENTENCE_END.finditer(text, end)), len(text))
    return text[left:right]


def check(text: str, *, director: bool = False) -> list[Exclusion]:
    """Requirements in `text` that make a vacancy ineligible, one per reason (the first phrase found).
    `director`: the text is the director's task, where "skip SC cleared roles" is a wish, not a requirement."""
    found: dict[str, Exclusion] = {}
    for reason, pattern in RULES:
        if reason in found:
            continue
        for match in pattern.finditer(text):
            sentence = _sentence(text, match.start(), match.end())
            if NEGATION.search(sentence) or (director and DIRECTOR_NEGATION.search(sentence)):
                continue
            if BASIC_CHECK.search(text[max(0, match.start() - 30) : match.start()]):
                continue
            found[reason] = Exclusion(reason, " ".join(match.group(0).split()))
            break
    return [found[r] for r in (CLEARANCE, RESIDENCY, NATIONALITY) if r in found]


def summary(exclusions_per_job: list[list[Exclusion]]) -> str:
    """"Excluded by the eligibility filter: 3 (2 security clearance …, 1 nationality …)"."""
    count = sum(1 for e in exclusions_per_job if e)
    reasons = Counter(e[0].reason for e in exclusions_per_job if e)
    detail = ", ".join(f"{n} {reason}" for reason, n in reasons.most_common())
    return f"Excluded by the eligibility filter: {count}" + (f" ({detail})" if detail else "")
