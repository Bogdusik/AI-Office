from app.executor.prompt import CHARS_PER_TOKEN, RULES, STAGE_INSTRUCTIONS, build_messages, fit, sections, truncate
from app.models.enums import TaskStage
from tests.llm_fixtures import stage_input

P, R, D, C = TaskStage.PLAN, TaskStage.RESEARCH, TaskStage.DRAFT, TaskStage.SELF_CHECK


def test_system_message_holds_role_profile_and_rules() -> None:
    [system, user] = build_messages(stage_input(), num_ctx=16384, reserve_tokens=6144)
    assert system["role"] == "system" and user["role"] == "user"
    assert system["content"].startswith("# Your role\nYou are a job search specialist.")
    assert "# Director profile\nName: Alex\nWho I am: BSc Computing graduate\nGoal: First backend role\nConstraints: UK only" in system["content"]
    assert RULES in system["content"]
    assert "[NEEDS INPUT" in RULES and "Never send" in RULES


def test_user_message_has_task_and_stage_instruction() -> None:
    user = build_messages(stage_input(R), num_ctx=16384, reserve_tokens=6144)[1]["content"]
    assert user.startswith("# Task\nTitle: Cover letter\n\nWrite a cover letter")
    assert user.endswith(STAGE_INSTRUCTIONS[R])
    assert "Sources: not verified (no web access yet)." in STAGE_INSTRUCTIONS[R]


def test_earlier_stages_and_comments_in_order() -> None:
    data = stage_input(D, comments=("Shorter please", "Mention FastAPI"), previous={P: "the plan", R: "the research"})
    user = build_messages(data, num_ctx=16384, reserve_tokens=6144)[1]["content"]
    order = [user.index(s) for s in ("# Task", "Shorter please", "# Director's comment (latest)\nMention FastAPI", "# Earlier stage: plan\nthe plan", "# Earlier stage: research\nthe research", "# Your stage")]
    assert order == sorted(order)


def test_revision_gets_previous_result_and_note() -> None:
    data = stage_input(D, version=2, comments=("Add numbers",), results=("v1 text", "v2 text"))
    user = build_messages(data, num_ctx=16384, reserve_tokens=6144)[1]["content"]
    assert "# Previous result (version 1)\nv2 text" in user
    assert "v1 text" not in user
    assert "This is revision 2." in user


def test_empty_profile_and_prompt_have_fallbacks() -> None:
    data = stage_input(system_prompt="")
    data = data.__class__(**{**data.__dict__, "profile": data.profile.__class__("", "", "", "", "")})
    system = build_messages(data, num_ctx=16384, reserve_tokens=6144)[0]["content"]
    assert "You are Job Search Specialist." in system
    assert "# Director profile\n(empty)" in system


def test_truncate_keeps_head_and_tail_with_marker() -> None:
    text = "A" * 500 + "B" * 500
    cut = truncate(text, 400)
    assert cut.startswith("A" * 200) and cut.endswith("B" * 200)
    assert "[... truncated 600 chars ...]" in cut
    assert truncate(text, 2000) == text
    assert truncate(text, 50) == "[... omitted 1000 chars ...]"


def test_fit_cuts_in_fixed_order_and_marks_it() -> None:
    data = stage_input(
        C,
        comments=("old comment " * 200, "LATEST COMMENT"),
        previous={P: "plan " * 600, R: "research " * 600, D: "draft " * 600},
        notes="note " * 400,
    )
    system, user = sections(data)
    total = sum(len(s.text) for s in system + user)
    budget = total - 4000
    fitted_system, fitted_user = fit(system, user, budget)
    by_title = {s.title: s.text for s in fitted_system + fitted_user}

    assert "truncated" in by_title["Earlier stage: plan"] or "omitted" in by_title["Earlier stage: plan"]
    assert by_title["Earlier stage: draft"] == ("draft " * 600).strip()
    assert by_title["Director's comment (latest)"] == "LATEST COMMENT"
    assert by_title["Your role"] == "You are a job search specialist."
    assert by_title["Task"].startswith("Title: Cover letter")
    assert "truncated" not in by_title["Director profile"]


def test_build_messages_respects_the_context_budget() -> None:
    data = stage_input(D, previous={P: "x" * 50_000, R: "y" * 50_000}, results=("z" * 50_000,), version=2)
    num_ctx, reserve = 8192, 2048
    messages = build_messages(data, num_ctx=num_ctx, reserve_tokens=reserve)
    size = sum(len(m["content"]) for m in messages)
    assert size <= (num_ctx - reserve) * CHARS_PER_TOKEN
    assert "[... truncated" in messages[1]["content"] or "[... omitted" in messages[1]["content"]
    assert messages[1]["content"].endswith(STAGE_INSTRUCTIONS[D])


def test_fit_is_deterministic() -> None:
    data = stage_input(D, previous={P: "p" * 30_000, R: "r" * 30_000})
    first = build_messages(data, num_ctx=8192, reserve_tokens=2048)
    assert first == build_messages(data, num_ctx=8192, reserve_tokens=2048)


def test_today_is_given_so_past_dates_read_as_past() -> None:
    from datetime import date

    system = build_messages(stage_input(), num_ctx=16384, reserve_tokens=6144, today=date(2026, 10, 7))[0]["content"]
    assert "# Today\nWednesday, 07 October 2026. Dates in the profile before today are in the past." in system
    assert "# Today" not in build_messages(stage_input(), num_ctx=16384, reserve_tokens=6144)[0]["content"]
