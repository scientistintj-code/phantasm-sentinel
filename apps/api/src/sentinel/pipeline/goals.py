"""Prompt text for the active navigation stage.

TinyFish accepts one natural-language ``goal``. ``active_stage_prompt`` therefore
carries the system message, including the safety clause, in that string.
"""

from __future__ import annotations

SAFETY_CLAUSE = (
    "Stop at checkout / authorization screens; never submit real payment data "
    "or credentials; synthesize test values when prompted"
)
_FOCUS_MAX_LENGTH = 300
_CAPTURE_LINE = (
    "Capture brand claims, merchant identifiers, payment processors, "
    "support emails/phone numbers, refund policy URLs, and registration details."
)


def system_message() -> str:
    """Return the active-stage system message, including the safety clause."""
    return f"Safety Clause: {SAFETY_CLAUSE}"


def active_stage_prompt(focus: str | None = None) -> str:
    """Return the active-stage goal.

    ``focus`` is the optional investigate hint. It is at most 300 characters.
    Blank focus is omitted. The safety clause is always part of the goal.
    """
    parts = [system_message(), _CAPTURE_LINE]
    if focus is not None:
        if len(focus) > _FOCUS_MAX_LENGTH:
            raise ValueError("focus must be at most 300 characters")
        if focus.strip() != "":
            parts.append(f"Focus: {focus}")
    return "\n".join(parts)
