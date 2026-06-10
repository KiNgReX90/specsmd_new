# CLAUDE.md

Canonical source for the SPECSMD **FIRE** tooling (agents, commands, skills, hooks, scripts) across Claude Code, Cursor, and Codex. This file carries only the specsmd-relevant guidance; it is project-agnostic on purpose.

## SPECSMD and Superpowers

SPECSMD drives the lifecycle (intent → work items → worktree → build → orchestrator-verified merge). Per-seam superpower wiring lives inside each specsmd agent definition; the `specsmd-skill-policy.py` hook hard-enforces the denial cases. The main thread only needs to know:

- **Capturing an intent defaults to the team planner.** When the user asks to capture or write an intent, route to `specsmd-fire-team-planner`, not `specsmd-fire-planner`. Team work items are a strict superset (they add `depends_on`, `context.required`, `ownership.editable`), so this never loses anything. The `specsmd-skill-policy.py` hook enforces this on cold main-thread entry.
- **Pick a track.** `/specsmd-fire` (sequential — one builder, one item at a time; use when items are coupled or checkpointing matters). `/specsmd-fire-team` (parallel builders in one intent worktree; use when items are mostly independent).
- **Specsmd owns the artifacts.** Intents, work items, runs, `.specs-fire/state.yaml`, walkthroughs. Don't author scratch plans or ad-hoc TodoWrite lists that should have been work items or runs.
- **Close your own intent automatically; never touch another session's.** When an intent is complete, run this sequence yourself, every time, without asking and without stopping at local commits:
  1. **Commit the close artifacts** (`.specs-fire/state.yaml` + the work-item statuses) on YOUR branch.
  2. **Merge** YOUR intent worktree/branch into the default branch.
  3. **Tear down the worktree if present:** first kill every process THAT worktree spawned (its dev-server port, any MCP/sidecar process, the build/compile process, and file watchers), then remove the worktree + branch. Never leave a merged worktree, or its processes, alive. A direct-on-branch build (no worktree) just deletes the merged branch.
  4. **Push** the default branch to origin.

  Scope the process-kill to THIS worktree only — processes whose working directory is inside it, or the specific port/PID it started; never blanket-kill shared toolchain processes that a concurrent session could be using. Other sessions' worktrees (any other `.worktrees/<id>` or `fire-intent/<other>` / `fix/<other>` branch, even one mid build) are never yours to merge, remove, kill, or ask about. A concurrent worktree is not a blocker and not a question; finish your own and move on.
- **Per-project config.** Project- and machine-specific values (worker model tiers, finalize verification commands, budget-halt paths, knowledge-base index) live in an optional `.specs-fire/config.yaml` — see `.specs-fire/config.example.yaml`. Every key is optional; without the file the flow runs on host/project defaults. The flow files under `.specsmd/` never hardcode these.
- **Generated Claude agent file.** `.claude/agents/specsmd-fire-team-builder.md` is GENERATED from the canonical `.specsmd/fire/agents/team-builder/agent.md` by `node .specsmd/fire/agents/team-builder/scripts/sync-claude-agent.cjs` (its frontmatter — e.g. per-repo `model:`/`effort:` pins — is preserved). Edit the canonical file, then re-run the sync; `--check` mode guards against drift.
- **Budget-cap halt.** When `halt.flag_file`/`halt.wait_script` are set in `.specs-fire/config.yaml`, builders and the team orchestrator honor that budget HALT flag: a gated builder writes a halt-note (`.specs-fire/halt-notes/<work_item_id>.md`) and returns `status: halted` (never re-dispatched); the orchestrator writes an intent-handoff, waits for the reset, then resumes the halted/pending items. Without halt config the gate is skipped and a halted run resumes manually.
- **Escape hatches.** If the user says "use superpowers" / "skip specsmd" / "brainstorm directly", or the work is outside `.specs-fire/`, treat superpowers as standalone tools and ignore the pairing rules.
