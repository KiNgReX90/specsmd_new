# SPECSMD FIRE Tooling

Canonical source for the SPECSMD **FIRE** workflow tooling: agents, slash commands, skills, hooks, and scripts for spec-driven AI development across **Claude Code**, **Cursor**, and **Codex**.

FIRE (Fast Intent-Run Engineering) drives the lifecycle **intent → work items → worktree → build → orchestrator-verified merge**. This repo extends the upstream baseline with, among other things:

- **Team flow** (`/specsmd-fire-team`): parallel builder subagents in one intent worktree, with dependency-aware dispatch, claim-on-select intent locking, and an orchestrator-verified merge gate.
- **Team planner** (`specsmd-fire-team-planner`): work items with `depends_on`, `context.required`, and `ownership.editable` so independent items build concurrently without edit collisions.
- **Portable per-project config** (`.specs-fire/config.yaml`): model tiers, finalize verification commands, and budget-halt wiring live per project; the flow files stay project-agnostic.
- **Budget-cap halt protocol**: builders write halt-notes and return cleanly when a spend cap is hit; the orchestrator hands off and resumes after reset.
- **Skill-policy hook** (`specsmd-skill-policy.py`): hard-enforces the agent/skill pairing rules instead of relying on prompt discipline.

## Layout

| Path | Contents |
|------|----------|
| `.specsmd/fire/` | Canonical flow definition: agent docs, skills, templates |
| `.claude/` | Claude Code surface: commands, agents, hooks, scripts |
| `.cursor/`, `.codex/` | Cursor and Codex surfaces |
| `CLAUDE.md` | The operating guidance an adopting project loads |

## Getting started

See [`.specsmd/fire/quick-start.md`](.specsmd/fire/quick-start.md) for the flow basics, and `.specs-fire/config.example.yaml` for the per-project configuration keys.

## Author

Created and maintained by **Rubèn Plantinga** ([@KiNgReX90](https://github.com/KiNgReX90)).

If you copy or fork this work, keep this attribution and the [LICENSE](LICENSE) file intact.

## Attribution

The original FIRE flow baseline was installed from the upstream [specsmd](https://github.com/fabriqaai/specs.md) project (MIT, by the specsmd team) at v0.1.65. Everything on top of that baseline, the team flow, team planner, halt protocol, policy hook, scripts, and portability work, is by Rubèn Plantinga.

## License

[MIT](LICENSE). Copyright (c) 2026 Rubèn Plantinga. Portions derived from specsmd, copyright the specsmd team, also under MIT.
