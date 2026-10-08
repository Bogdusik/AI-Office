import pytest

from app.jobs.eligibility import CLEARANCE, NATIONALITY, RESIDENCY, Exclusion, check, summary

EXCLUDED: list[tuple[str, str]] = [
    # security clearance with a residency condition
    ("Candidates must hold active SC clearance.", CLEARANCE),
    ("This role requires SC Clearance or the ability to obtain it.", CLEARANCE),
    ("You will need to be SC cleared to start.", CLEARANCE),
    ("Must be SC-cleared or eligible.", CLEARANCE),
    ("Applicants must be eligible for SC.", CLEARANCE),
    ("Current DV clearance is essential.", CLEARANCE),
    ("DV cleared engineers preferred, eDV vetting desirable.", CLEARANCE),
    ("NPPV3 vetting will be carried out.", CLEARANCE),
    ("Successful candidates will need NPPV 3 clearance.", CLEARANCE),
    ("Security clearance (SC) is required for this post.", CLEARANCE),
    ("Must be willing to undergo Security Check (SC) vetting.", CLEARANCE),
    ("All staff are subject to Security Check clearance.", CLEARANCE),
    ("The post holder will be required to obtain Developed Vetting.", CLEARANCE),
    ("Counter Terrorist Check (CTC) clearance needed.", CLEARANCE),
    ("Applicants must be eligible for security clearance.", CLEARANCE),
    ("Security clearance is mandatory for this contract.", CLEARANCE),
    ("Cleared to SC level or above.", CLEARANCE),
    # years of UK residency
    ("You must have 5 years UK residency.", RESIDENCY),
    ("Applicants need five (5) years' continuous residency in the UK.", RESIDENCY),
    ("Candidates require 10 years of UK residence.", RESIDENCY),
    ("You must have been resident in the UK for the last 5 years.", RESIDENCY),
    ("Must have lived in the United Kingdom continuously for at least ten years.", RESIDENCY),
    ("UK residency for the past 3 years is required.", RESIDENCY),
    # nationality or citizenship
    ("Applicants must be UK nationals since birth.", NATIONALITY),
    ("This post is open to sole British nationals only.", NATIONALITY),
    ("British citizens only due to the nature of the work.", NATIONALITY),
    ("Open only to UK nationals.", NATIONALITY),
    ("You must be a British citizen.", NATIONALITY),
    ("British nationality is essential.", NATIONALITY),
    ("Dual nationals are not eligible for this role.", NATIONALITY),
]

ELIGIBLE: list[str] = [
    # basic checks only
    "All offers are subject to BPSS clearance.",
    "Baseline Personnel Security Standard (BPSS) checks apply.",
    "BPSS security clearance is required before you start.",
    "You will complete a background security check and a DBS check.",
    "Offers are subject to standard pre-employment checks.",
    # requirement explicitly not needed
    "SC clearance is not required for this role.",
    "No security clearance needed.",
    "This role does not require DV clearance.",
    "You don't need SC clearance; BPSS is enough.",
    # SC and DV meaning something else
    "Join the marketing team at SC Johnson in Leeds.",
    "Remote role, team based in Charleston, SC (South Carolina).",
    "Experience with DV360 and Google Ads campaigns.",
    "You will build tools for our DV (domestic violence) support service.",
    "Our SC (Sports Club) app has 50k users.",
    "Knowledge of AC/DC and DV/DT measurements is a plus.",
    "Strong Scala (SC) and Python skills.",
    # other wording that must not count
    "You must have the right to work in the UK.",
    "We welcome applications from all nationalities.",
    "Applicants must be a British citizen or have settled status.",
    "5 years of experience with Python is desirable.",
    "We do not offer visa sponsorship.",
    "Hybrid: 2 days a week in our Leeds office, residency in Yorkshire not required.",
]


@pytest.mark.parametrize(("text", "reason"), EXCLUDED)
def test_requirements_that_exclude_a_vacancy(text: str, reason: str) -> None:
    found = check(text)
    assert [e.reason for e in found] == [reason], text
    assert found[0].phrase.lower() in text.lower()


@pytest.mark.parametrize("text", ELIGIBLE)
def test_wording_that_does_not_exclude(text: str) -> None:
    assert check(text) == [], text


def test_one_exclusion_per_reason_in_a_full_advert() -> None:
    advert = (
        "Python Developer (Defence). Hybrid, Bristol.\n"
        "Due to the nature of the work you must hold SC clearance and be a sole British national. "
        "You must have been resident in the UK for the last 5 years. BPSS checks also apply."
    )
    assert [e.reason for e in check(advert)] == [CLEARANCE, RESIDENCY, NATIONALITY]


def test_negation_only_counts_in_its_own_sentence() -> None:
    assert check("BPSS is not required for the internship. The main role needs SC clearance.")[0].reason == CLEARANCE


def test_the_directors_own_request_is_a_wish_not_a_requirement() -> None:
    request = "Find junior Python roles in Leeds. Skip anything that needs SC clearance or British citizens only."
    assert check(request, director=True) == []
    assert check("I don't have SC clearance, so leave those out.", director=True) == []
    assert [e.reason for e in check("Junior developer, SC cleared, Leeds.", director=True)] == [CLEARANCE]


def test_summary_counts_vacancies_by_reason() -> None:
    clearance, nationality = Exclusion(CLEARANCE, "SC cleared"), Exclusion(NATIONALITY, "British citizens only")
    line = summary([[clearance], [], [clearance, nationality], [nationality]])
    assert line == f"Excluded by the eligibility filter: 3 (2 {CLEARANCE}, 1 {NATIONALITY})"
    assert summary([[], []]) == "Excluded by the eligibility filter: 0"
