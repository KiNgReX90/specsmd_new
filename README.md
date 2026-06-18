# SPECSMD INFERNO Tooling

Canonical source for the SPECSMD **INFERNO** flow tooling: agents, slash commands, and skills for spec-driven AI development with **Claude Code** (plus a Codex skill surface).

INFERNO is a standalone specsmd flow — chosen at install time *instead of* FIRE — that drives the lifecycle **intent → auto-decomposed work items → one intent worktree → parallel autopilot builders → orchestrator-verified merge**, all under its own `.specs-inferno/` artifact namespace. It extends the upstream baseline with, among other things:

- **Autonomous parallel flow** (planner, builder, orchestrator): one planner auto-decomposes an intent into work items with `depends_on`, `context.required`, and `ownership.editable`, then parallel autopilot builders run in one intent worktree with dependency-aware dispatch, claim-on-select intent locking, and an orchestrator-verified merge gate. Planning autonomy is config-driven via `autonomy.level`.
- **Portable per-project config** (`.specs-inferno/config.yaml`): model tiers, finalize verification commands, `autonomy.level`, and budget-halt wiring live per project; the flow files stay project-agnostic.
- **Budget-cap halt protocol**: builders write halt-notes and return cleanly when a spend cap is hit; the orchestrator hands off and resumes after reset.

## Layout

| Path | Contents |
|------|----------|
| `.specsmd/inferno/` | Canonical flow definition: agent docs, skills, templates |
| `.claude/` | Claude Code surface: commands, agents |
| `.codex/` | Codex skill surface for the flow |
| `CLAUDE.md` | The operating guidance an adopting project loads |

## Getting started

INFERNO is installed by choosing it at `specsmd install` time. See `CLAUDE.md` for the operating guidance an adopting project loads, and `.specsmd/inferno/agents/orchestrator/config.example.yaml` for the per-project configuration keys.

## Author

Created and maintained by **Rubèn Plantinga** ([@KiNgReX90](https://github.com/KiNgReX90)).

If you copy or fork this work, keep this attribution and the [LICENSE](LICENSE) file intact.

## Attribution

The INFERNO autonomous parallel flow (planner, builder, orchestrator), the halt protocol, and the portability work are by **Rubèn Plantinga**.

## License

[MIT](LICENSE). Copyright (c) 2026 Rubèn Plantinga.
