"""Active-stage prompts include the safety clause and optional focus."""

from __future__ import annotations

import pytest

from sentinel.pipeline.goals import SAFETY_CLAUSE, active_stage_prompt, system_message

_CAPTURE = (
    "brand claims",
    "merchant identifiers",
    "payment processors",
    "support emails/phone numbers",
    "refund policy URLs",
    "registration details",
)


def test_system_message_includes_safety_clause() -> None:
    message = system_message()
    assert SAFETY_CLAUSE in message
    assert "Stop at checkout / authorization screens" in message


def test_prompt_includes_safety_clause_and_capture_targets() -> None:
    prompt = active_stage_prompt()
    assert SAFETY_CLAUSE in prompt
    assert system_message() in prompt
    for phrase in _CAPTURE:
        assert phrase in prompt
    assert "Focus:" not in prompt


def test_focus_is_inserted() -> None:
    focus = "descriptor on the card authorization screen"
    prompt = active_stage_prompt(focus)
    assert f"Focus: {focus}" in prompt
    assert SAFETY_CLAUSE in prompt
    assert "support emails/phone numbers" in prompt


def test_blank_focus_is_omitted() -> None:
    assert active_stage_prompt("   ") == active_stage_prompt(None)
    assert active_stage_prompt("") == active_stage_prompt()


def test_focus_over_300_characters_is_rejected() -> None:
    with pytest.raises(ValueError, match="300"):
        active_stage_prompt("x" * 301)
    accepted = active_stage_prompt("y" * 300)
    assert "y" * 300 in accepted
