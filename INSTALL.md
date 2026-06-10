# Integrating the FIRE Team Flow into a Host Repo

This document is written for the **agent performing the integration**. The scenario: the host repo already has SPECSMD installed (the FIRE flow; if the host runs the AIDLC flavor instead, install the FIRE flow first — this overlay reads and writes FIRE artifacts under `.specs-fire/`), and this repo is being copied in **on top of** that install. Nothing here replaces the upstream baseline; the team flow coexists with it.

The reference integration is the Skoft_Files repo: when in doubt about a wiring decision, match what that setup does.

## 0. Preconditions — verify before copying

- Host has `.specsmd/fire/` and `.specs-fire/` (a SPECSMD FIRE install). If `.specs-fire/` is missing, initialize the FIRE flow with the upstream specsmd CLI first.
- Host is a git repo with a clean-enough working tree to review the overlay as one diff.

## 1. Copy the overlay

Copy these paths from this repo into the host repo at the **same relative paths**:

| Group | Paths |
|-------|-------|
| Canonical team agents | `.specsmd/fire/agents/team/`, `.specsmd/fire/agents/team-builder/`, `.specsmd/fire/agents/team-planner/` (entire trees) |
| Claude Code agents | `.claude/agents/specsmd-fire-team.md`, `specsmd-fire-team-planner.md`, `specsmd-fire-team-builder.md` |
| Claude Code commands | `.claude/commands/specsmd-fire-team.md`, `specsmd-fire-team-planner.md`, `specsmd-fire-team-builder.md` |
| Policy hook | `.claude/hooks/specsmd-skill-policy.py` |
| Shared scripts | `.claude/scripts/*.cjs` and `.claude/scripts/__tests__/` |
| Codex surface (only if the host uses Codex) | `.codex/skills/specsmd-fire-team*/` |
| Config template | `.specs-fire/config.example.yaml` |
| Attribution | copy `LICENSE` to `.specsmd/fire/agents/LICENSE-team-flow` so the MIT notice travels with the files |

Conflict rules:

- **Never overwrite host files that came from the upstream specsmd install** (e.g. `.specsmd/fire/memory-bank.yaml`, the sequential planner/builder/orchestrator trees if present). Only add.
- Do **not** copy this repo's `README.md`, `LICENSE` (root), or `CLAUDE.md` wholesale into the host root. CLAUDE.md is merged in step 3; the license travels via the attribution row above.

## 2. Register the hook

Merge these entries into the host's `.claude/settings.json` `hooks` object (create keys that don't exist, append to arrays that do):

```json
{
  "UserPromptExpansion": [
    {
      "matcher": "^specsmd-fire",
      "hooks": [
        { "type": "command", "command": "python3 .claude/hooks/specsmd-skill-policy.py", "timeout": 5 }
      ]
    }
  ],
  "PreToolUse": [
    {
      "matcher": "Skill",
      "hooks": [
        { "type": "command", "command": "python3 .claude/hooks/specsmd-skill-policy.py", "timeout": 5 }
      ]
    }
  ]
}
```

Without both events the skill-pairing policy and the team-planner redirect are prompt-discipline only; the hook is what makes them hard rules.

## 3. Merge CLAUDE.md guidance

Append the **"SPECSMD and Superpowers"** section from this repo's `CLAUDE.md` into the host's `CLAUDE.md` (or create one). Adapt, don't paste blindly:

- If the host repo keeps the upstream sequential track, restore a "pick a track" line offering both `/specsmd-fire` and `/specsmd-fire-team`; otherwise keep the team-only wording.
- If the host has no superpowers plugin, drop the escape-hatch sentence that references it; the hook's superpowers pairings are inert without the plugin and need no change.
- Project-specific values (process names in the close sequence, knowledge-base mentions) must be rewritten for the host project.

## 4. Create `.specs-fire/config.yaml`

Copy `config.example.yaml` to `config.yaml` and fill in per-project values. Every key is optional, but in practice you want:

- `models.strong` / `models.cheap` — verbatim Agent-tool model values (aliases like `opus` / `sonnet`); never remapped by the flow.
- `verification.finalize` — the host project's authoritative build/test/check commands, ending with `node .specsmd/fire/agents/team-builder/scripts/sync-claude-agent.cjs --check` to guard generated-agent drift.
- `halt.*` — only if the machine uses a budget-cap halt protocol; omit otherwise.
- `knowledge.index` — only if the host has a knowledge base index file; omit otherwise.

## 5. Pin the builder model (optional but recommended)

`.claude/agents/specsmd-fire-team-builder.md` is GENERATED from `.specsmd/fire/agents/team-builder/agent.md`. Its frontmatter is preserved by the sync script, so set per-repo pins there (the reference uses `model: claude-opus-4-8` + `effort: xhigh`), then run:

```bash
node .specsmd/fire/agents/team-builder/scripts/sync-claude-agent.cjs --check
```

## 6. Verify

Run from the host repo root; all must pass:

```bash
node .specsmd/fire/agents/team-builder/scripts/sync-claude-agent.cjs --check
node .claude/scripts/__tests__/specsmd-fire-intent-worktree.test.cjs
node .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs
node .specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs
```

Then **restart the Claude Code session**: agent definitions and their tool lists are cached at session start, so the new `specsmd-fire-team*` agents are not visible to the session that copied them. After restart, confirm `/specsmd-fire-team` is offered and that invoking `specsmd-fire-planner` cold gets redirected to the team planner by the hook.

## 7. Commit

Commit the overlay as one reviewable change in the host repo, noting the source: `github.com/KiNgReX90/specsmd_new` by Rubèn Plantinga.
