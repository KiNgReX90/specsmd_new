#!/usr/bin/env python3
"""
Enforce per-phase skill policy for specsmd-fire agents and slash-command
personas. Driven by two hook events wired in .claude/settings.json:

  UserPromptExpansion  (matcher: ^specsmd-fire) -> record active role marker
  PreToolUse           (matcher: Skill)         -> deny disallowed skills

Role identification order inside PreToolUse:
  1. tool payload `agent_type` (true subagents)
  2. .specs-fire/active-role marker (slash-command personas in main thread)
"""

import json
import os
import sys
import time
from pathlib import Path

MARKER_RELATIVE = ".specs-fire/active-role"
MARKER_TTL_SECONDS = 6 * 60 * 60  # 6h; pruned on read if older

# Deny rules: { role -> set(skill names that must be blocked) }
# Skill names match the value the model passes as `tool_input.skill`.
DENY: dict[str, set[str]] = {
    "specsmd-fire-planner":       {"superpowers:writing-plans"},
    "specsmd-fire-team-planner":  {"superpowers:writing-plans"},
    "specsmd-fire-team-builder":  {
        "superpowers:dispatching-parallel-agents",
        "superpowers:subagent-driven-development",
    },
}

# Reasons surfaced back to the model (mirrors CLAUDE.md §SPECSMD seams).
REASON = {
    "superpowers:writing-plans":
        "Planners must not invoke writing-plans. Brainstorm output feeds "
        "specsmd's work-item-decompose skill, which is the sole authority "
        "for work-item shape. See CLAUDE.md §SPECSMD and Superpowers.",
    "superpowers:dispatching-parallel-agents":
        "Team builders work on exactly one item and never spawn subagents. "
        "See CLAUDE.md §SPECSMD and Superpowers.",
    "superpowers:subagent-driven-development":
        "Team builders work on exactly one item and never spawn subagents. "
        "See CLAUDE.md §SPECSMD and Superpowers.",
}


def _marker_path(cwd: str) -> Path:
    return Path(cwd) / MARKER_RELATIVE


def _read_role_from_marker(cwd: str) -> str | None:
    path = _marker_path(cwd)
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    except OSError:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
        role = data.get("role")
        written_at = float(data.get("written_at", 0))
    except (ValueError, TypeError):
        return None
    if not role:
        return None
    if written_at and (time.time() - written_at) > MARKER_TTL_SECONDS:
        # Stale; prune so we don't keep enforcing on a forgotten role.
        try:
            path.unlink()
        except OSError:
            pass
        return None
    return role


def _write_role_marker(cwd: str, role: str) -> None:
    path = _marker_path(cwd)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"role": role, "written_at": time.time()}
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(tmp, path)


def _emit_deny(reason: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    sys.stdout.write("\n")


def handle_user_prompt_expansion(event: dict) -> int:
    command = event.get("command_name") or ""
    if not command.startswith("specsmd-fire"):
        return 0
    cwd = event.get("cwd") or os.getcwd()
    _write_role_marker(cwd, command)
    return 0


def handle_pre_tool_use(event: dict) -> int:
    if event.get("tool_name") != "Skill":
        return 0
    tool_input = event.get("tool_input") or {}
    skill = tool_input.get("skill")
    if not skill:
        return 0

    role = event.get("agent_type")
    if not role:
        role = _read_role_from_marker(event.get("cwd") or os.getcwd())

    # Project policy: intent capture defaults to the team planner.
    # When the solo planner is invoked cold from the main thread (no active
    # specsmd role), redirect to the team planner. Internal routing from a
    # running specsmd persona (role marker set) is left untouched.
    if not role and skill == "specsmd-fire-planner":
        _emit_deny(
            "This project defaults intent capture to the team planner. "
            "Invoke specsmd-fire-team-planner instead of specsmd-fire-planner."
        )
        return 0

    if not role:
        return 0

    denied = DENY.get(role)
    if not denied or skill not in denied:
        return 0

    reason = REASON.get(
        skill,
        f"Skill {skill} is not allowed for role {role}.",
    )
    _emit_deny(f"[{role}] {reason}")
    return 0


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (ValueError, json.JSONDecodeError):
        return 0

    name = event.get("hook_event_name") or event.get("hookEventName")
    if name == "UserPromptExpansion":
        return handle_user_prompt_expansion(event)
    if name == "PreToolUse":
        return handle_pre_tool_use(event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
