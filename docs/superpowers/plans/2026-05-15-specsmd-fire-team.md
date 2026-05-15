# specsmd-fire-team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `specsmd-fire-team` workflow that runs dependency-ready work items through parallel builder subagents inside one intent worktree.

**Architecture:** Add a sibling command, agent, and skill family without modifying existing `specsmd-fire` files. A lightweight team scheduler module validates context manifests, computes dependency frontiers, prevents ownership-overlap dispatch, and renders compact builder prompts/results policy for the new orchestration docs.

**Tech Stack:** Markdown agent/skill docs, Claude command files, Node.js CommonJS tests using the built-in `node:test` and `assert` modules.

---

### Task 1: Team Scheduler Contract

**Files:**
- Create: `.specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.cjs`
- Create: `.specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs`

- [x] **Step 1: Write scheduler tests**

Create tests for manifest validation, dependency-frontier scheduling, ownership overlap, compact prompt creation, and compact result validation.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs`

Expected: FAIL because `team-scheduler.cjs` does not exist yet.

- [x] **Step 3: Implement scheduler helpers**

Export `validateWorkItem`, `selectDispatchableItems`, `buildBuilderPrompt`, and `validateBuilderResult`.

- [x] **Step 4: Run scheduler tests**

Run: `node --test .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs`

Expected: PASS.

### Task 2: Team Orchestrator Files

**Files:**
- Create: `.codex/skills/specsmd-fire-team/SKILL.md`
- Create: `.claude/commands/specsmd-fire-team.md`
- Create: `.claude/agents/specsmd-fire-team.md`
- Create: `.specsmd/fire/agents/team/agent.md`
- Create: `.specsmd/fire/agents/team/skills/orchestrate/SKILL.md`

- [x] **Step 1: Add command and Codex skill activation files**

Create sibling activation files that point to `.specsmd/fire/agents/team/agent.md`.

- [x] **Step 2: Add team orchestrator agent**

Create an agent that owns intent worktree setup, dependency scheduling, subagent dispatch, serialized validation/commits/state updates, final verification, merge, and cleanup.

- [x] **Step 3: Add orchestrate skill**

Document validation gates, context-economy policy, dispatch algorithm, result handling, and error behavior.

### Task 3: Team Builder Files

**Files:**
- Create: `.codex/skills/specsmd-fire-team-builder/SKILL.md`
- Create: `.claude/commands/specsmd-fire-team-builder.md`
- Create: `.claude/agents/specsmd-fire-team-builder.md`
- Create: `.specsmd/fire/agents/team-builder/agent.md`
- Create: `.specsmd/fire/agents/team-builder/skills/workitem-execute/SKILL.md`

- [x] **Step 1: Add builder activation files**

Create sibling activation files that point to `.specsmd/fire/agents/team-builder/agent.md`.

- [x] **Step 2: Add team builder agent**

Create an agent that handles exactly one assigned work item, starts from the manifest, expands context autonomously only when needed, edits within ownership, runs tests, and returns compact results.

- [x] **Step 3: Add workitem-execute skill**

Document the builder execution sequence, context expansion rules, ownership rules, blocked-result behavior, and compact result format.

### Task 4: Verify And Publish

**Files:**
- Modify: `docs/superpowers/plans/2026-05-15-specsmd-fire-team.md`

- [x] **Step 1: Run tests**

Run: `node --test .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs`

Expected: PASS.

- [x] **Step 2: Confirm existing specsmd files were not modified**

Run: `git diff --name-only HEAD -- .codex/skills/specsmd-fire .codex/skills/specsmd-fire-builder .codex/skills/specsmd-fire-planner .claude/commands/specsmd-fire.md .claude/commands/specsmd-fire-builder.md .claude/commands/specsmd-fire-planner.md .claude/agents/specsmd-fire.md .claude/agents/specsmd-fire-builder.md .claude/agents/specsmd-fire-planner.md .specsmd/fire/agents/orchestrator .specsmd/fire/agents/builder .specsmd/fire/agents/planner`

Expected: no output.

- [x] **Step 3: Commit implementation**

Run: `git add . && git commit -m "Add specsmd fire team workflow"`

Expected: commit succeeds.

- [x] **Step 4: Push implementation**

Run: `git push`

Expected: push succeeds.
