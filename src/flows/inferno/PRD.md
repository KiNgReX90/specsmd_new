# PRD — INFERNO Flow

**Status:** living document · **Owner:** specsmd flow maintainers · **Audience:** flow maintainers, contributors, and operators evaluating which specsmd flow to adopt.

---

## One-page summary

**INFERNO is the autonomous, parallel build flow for specsmd.** You give it an intent; it captures the load-bearing decisions, decomposes the work into dependency-ordered work items, and then runs *parallel autopilot builder subagents* inside a single intent worktree — scheduled by a dependency frontier, kept collision-free by file-ownership mutual exclusion, and closed by an orchestrator-verified merge. It is chosen at install time *instead of* FIRE and owns its own `.specs-inferno/` artifact namespace.

- **Problem it solves:** serial, gate-heavy flows leave most of an intent's parallelizable work idle and force a human into every step. INFERNO removes the per-step human gates and fans independent work out across many builders, so wall-clock is driven by the longest dependency chain rather than the sum of all work.
- **Target user:** a developer or team who has a reasonably well-understood intent and wants it built end-to-end — planned, implemented, verified, merged, and pushed — with one explicit "go" and minimal supervision.
- **The core bet:** you can flatten planning into parallel, self-verifying work items **without losing build quality** — *provided* every load-bearing caveat survives into the builder-facing work item, and a real verification gate guards the merge.
- **Headline capabilities:**
  1. One conversational planner that decomposes an intent into contract-valid work items and then stops (the build is always a separate, explicit step).
  2. Dependency-frontier scheduling with file-ownership mutual exclusion — independent items build concurrently; coupled items serialize automatically.
  3. Autopilot, TDD-gated builders that own exactly one work item and never touch shared state.
  4. An orchestrator-verified finalize: full verification on the integrated tree, then merge + push (auto-close) or a single review MR (merge-request).
  5. Claim-on-select intent locking so concurrent sessions never pick the same intent.
  6. Optional budget-cap halt/resume, model-tier cost control, and a forge-aware merge-request delivery mode.

**Evidence (internal head-to-head evaluations, two production codebases on different stacks):** an INFERNO build driven only by flattened work items — real TDD-gated builders, no boilerplate prose — produced a fully-scoped, compiling, heavily unit-tested implementation that was **competitive with a doc-heavy serial alternative and more faithful to the written acceptance criteria**, and it eliminated a phantom-schema defect that an earlier non-TDD run had shipped. The same evaluations also pin INFERNO's two real risks: **caveat loss** (a lean, link-only work item that hides caveats behind unresolved links produced load-bearing defects, and in one case an outright hollow build) and **under-realized parallelism** (a naive 1:1 story→item decomposition fanned out only 2-wide). Both are addressed below.

---

## 1. Problem & context

specsmd ships several flows. FIRE and full AI-DLC are **human-paced**: planning emits a stack of documents and the build advances through per-step checkpoints a human approves. That is safe and legible, but it has two costs:

1. **Serialization.** Even when an intent contains many independent pieces, a checkpoint-gated flow tends to build them one at a time. The parallelism is left on the table.
2. **Supervision overhead.** Every gate is a context switch for the operator. For an intent that is already well understood, most of those gates add latency, not safety.

INFERNO exists for the case where the operator wants to **trade per-step oversight for throughput and autonomy**, without trading away correctness. It sits at the autonomous end of the specsmd flow spectrum: one planning pass, one explicit build command, and an orchestrator that runs the whole intent to a verified merge.

It is deliberately a **standalone** flow, not a mode of FIRE: it has its own `.specs-inferno/` artifact namespace, its own state file, and shares no state with any other flow. Because the standalone flow ships exactly one planner, there is no "which planner?" routing decision and no policy hook to configure.

## 2. Target users & use cases

**Primary user:** an experienced developer or a small team driving a feature they understand well enough to describe crisply, who wants it built with minimal hand-holding.

**Strong-fit use cases:**

- A feature that decomposes into several **independent** surfaces (e.g. separate modules, pages, or services) that can be built and tested in parallel.
- Brownfield change sets where the *what* is clear and the value is in execution speed: refactors with a known target shape, multi-file mechanical changes, parity work.
- Overnight / unattended runs: plan during the day, start the build with a scheduled run, return to a merged (or review-ready) intent.

**Poor-fit use cases (use FIRE or AI-DLC Turbo instead):**

- Exploratory work where requirements are still being discovered and the human wants to steer each step.
- Single-file, single-concern changes where orchestration overhead exceeds the work itself.
- Work whose correctness depends on judgement calls a human must make mid-build rather than up front.

## 3. Goals & non-goals

**Goals**

- G1. Take a captured intent to a **verified, merged (or review-ready)** result with exactly one human "go" after planning.
- G2. **Maximize safe parallelism**: dispatch the widest ready frontier that file-ownership and dependencies permit, with a near-zero edit-collision rate.
- G3. **Preserve build quality** at parity with human-paced flows — specifically caveat handling, spec fidelity, and test coverage.
- G4. **Control cost** by routing trivial work to a cheap model tier and reserving the strong tier for reasoning-bearing items.
- G5. **Be safe under concurrency**: multiple sessions, multiple intents, and other flows can operate on the same repo without corrupting each other's work.

**Non-goals**

- N1. INFERNO does **not** discover requirements for you. The planner asks clarifying questions, but a vague intent produces a vague plan.
- N2. INFERNO does **not** provide per-step human checkpoints during the build. Oversight is the single urgent-only review point after planning (under `production` mode) plus the verified finalize. If you want step gates, this is the wrong flow.
- N3. INFERNO does **not** manage long-lived product roadmaps or cross-release capability specs. It is a feature-batch flow: scope an intent, build it, close it.
- N4. The planner never starts the build, and builders never choose extra work, commit, or edit shared state. These are hard boundaries, not configurable.

## 4. Value proposition

**Versus FIRE / full AI-DLC (human-paced):** INFERNO removes the per-step gates and the boilerplate planning documents, and replaces serial bolt execution with parallel builders. For a well-understood intent this is dramatically less wall-clock and dramatically less operator attention, at the same build quality — *when the caveat-survival discipline holds* (see §9 and §10).

**Versus a generic "just let an agent build it" approach:** INFERNO adds the three things a naive autonomous build lacks:

- **A contract.** Every work item must carry a complete context manifest, explicit `depends_on`, and a truthful `ownership.editable` set. Invalid items stop the run before anything is built.
- **A scheduler.** Dependency-frontier dispatch with ownership mutual-exclusion means parallel builders never collide on the same files, and dependents never start before their prerequisites land.
- **A verified gate.** No intent closes until the full verification suite passes on the *integrated* tree — not just per-item tests.

The result is autonomy with guardrails: the speed of "let it run" with the correctness discipline of a reviewed flow.

## 5. How it works

### Lifecycle

```
intent  →  decisions/caveats ledger  →  work items  →  one intent worktree  →  parallel autopilot builders  →  orchestrator-verified finalize (merge + push, or review MR)
```

### Surfaces

| Command | Role |
|---|---|
| `/specsmd-inferno` | **Orchestrator** — selects an intent, runs the parallel build to a verified merge/close. |
| `/specsmd-inferno-planner` | Captures an intent and decomposes it into work items, then stops. |
| `/specsmd-inferno-builder` | Autopilot subagent dispatched by the orchestrator for **exactly one** work item. |
| `/specsmd-inferno-writer` | Pure-scribe subagent dispatched by the planner to render **exactly one** work-item file from a complete decision record. |
| `/specsmd-inferno-config` | Wizard for the optional `.specs-inferno/config.yaml`. |
| `inception-to-inferno` | Bridge that converts a completed AI-DLC intent into an INFERNO brief + one work item per story. |

### Planner

The planner is a strong-model agent that does **all** decomposition reasoning, then fans the *writing* out to parallel scribes so authoring many work items doesn't serialize. Its procedure:

1. **Capture** the intent through dialogue (what / who / why / constraints); never assume requirements. Depth is mode-driven: `production` runs a staged questionnaire (core questions -> a mandatory deep-dive across functional edge cases, error handling, data/storage, integrations, and NFRs -> a full summary approval); `autonomous` runs one lean, open-ended pass.
2. **Cross-intent reconciliation** — compare the new intent against every open (non-completed) intent and classify it: *integrate* (fold into an existing pending intent), *depend* (record an intent-level `depends_on` so the orchestrator only offers it once its prerequisite completes), *independent*, or *conflict* (always surfaced). A new intent is never queued blind to work already planned.
3. **Decisions/caveats homework** — write a trimmed requirements doc and a dated decisions + load-bearing-caveats ledger, once.
4. **Decompose** into work items: assign `kind` and `complexity`, define acceptance criteria, inline every governing caveat, set `depends_on`, define `context.required` / `context.patterns` / `context.tests`, and set a truthful `ownership.editable`.
5. **Caveat-survival check** — every caveat in the ledger must be homed in ≥1 work item and every requirement covered by ≥1 item, *before* the items are written.
6. **Size-check** — an item a builder can't finish in roughly ≤30 tool rounds, or whose context spans more than ~6 files or two distinct concerns, is split.
7. **Write** — emit a complete decision record per item and dispatch one writer scribe per item, in parallel; the planner alone updates `state.yaml`.
8. **Hand off and STOP.** The build is always a separate, explicit step.

### Orchestrator

The orchestrator owns the intent worktree, the dependency graph, builder dispatch, and serialized integration:

- **Select** an intent from a numbered menu (never auto-pick), honoring intent-level `depends_on`; intents `in_progress` elsewhere are listed as "running elsewhere" and never offered.
- **Claim-on-select** — set the intent `in_progress` and commit on the default branch *before* creating the worktree. That commit is what stops a concurrent session from picking the same intent.
- **One worktree** — `inferno-intent/{id}-{timestamp}`; all builders run inside it; never in-place, never per-item sub-worktrees.
- **Dispatch loop** — build the dependency graph; the ready frontier is pending items whose dependencies are all complete and whose `ownership.editable` does not overlap an in-flight item; dispatch the whole frontier in one round.
- **Model-tier cost control** — `kind: config-only | docs-only | test` and `complexity: low` go to the cheap tier; `medium`/`high` reasoning-bearing items go to the strong tier.
- **Serialized integration** — process builder results one at a time; reject noisy results; validate `changed_files` against `ownership.editable`; run/confirm verification; commit (or open a per-item MR); update state; recompute the frontier and dispatch newly unblocked items immediately.
- **Finalize** — once no pending/in-flight items remain: run the full `verification.finalize` gate on the integrated tree, mark the intent completed, then **ship** (merge locally + push, or push + open one review MR), tear down the worktree and its processes, and report in plain language.

### Builders

Each builder is an autopilot subagent dispatched with only pointers (work-item id, worktree path, the item's `context` manifest and `ownership.editable`, the verification command) — never file bodies, never restated policy. Hard boundaries: builders may **not** commit, edit `.specs-inferno/state.yaml`, spawn nested subagents, or choose extra work. They run the mandatory TDD gate before the first implementation edit and return a strict YAML result contract (`ready | blocked | halted`).

## 6. Functional requirements

Numbered and testable.

- **FR-1 (Intent capture).** The planner must capture an intent through dialogue and never assume requirements; a captured intent has a clear goal and success criteria.
- **FR-2 (Cross-intent reconciliation).** On capture, the new intent must be classified against all open intents as integrate / depend / independent / conflict, with any intent-level `depends_on` recorded acyclically in state and the brief.
- **FR-3 (Decisions ledger).** The planner must write a trimmed requirements doc and a dated decisions + load-bearing-caveats ledger before decomposition.
- **FR-4 (Work-item contract).** Every work item must carry a non-empty `context.required`, a non-empty `ownership.editable`, `depends_on`, `context.patterns` for behavior/architecture/UI/API work, and `context.tests` unless explicitly docs-only or config-only. Invalid items stop the run with the exact missing fields named.
- **FR-5 (Caveat survival).** Every load-bearing caveat must survive into ≥1 work item — inlined in its body **and** linked via `context.required`. The caveat-survival check must pass before work items are written.
- **FR-6 (No build from planner).** The planner must stop after writing the work items; it must never start or route into the build.
- **FR-7 (Mode).** The top-level `mode: production | autonomous` controls exactly three things: intake depth (`production`'s staged deep-intake questionnaire vs. `autonomous`'s lean single pass), whether the planner pauses once for an urgent-only review after writing (`production` pauses; `autonomous` stops with no pause), and the delivery default (`production` -> `merge-request`, `autonomous` -> `auto-close`, always overridable by an explicit `delivery.mode`). It never adds per-item checkpoints. Absent `mode` defaults to `production`. *(Migration: legacy `autonomy.level: review` maps to `production`, `autonomy.level: full` maps to `autonomous`.)*
- **FR-8 (Intent selection & claim).** The orchestrator must never auto-select an intent; it must claim the selected intent (commit on the default branch) before creating the worktree.
- **FR-9 (Isolation).** The run must execute inside exactly one dedicated intent worktree; in-place execution is an explicit user override only.
- **FR-10 (Frontier scheduling).** The orchestrator must dispatch only items whose dependencies are complete and whose `ownership.editable` does not overlap an in-flight or co-selected item.
- **FR-11 (Serialized state).** All git commits and all `.specs-inferno/state.yaml` updates must be serialized in the orchestrator; builders must not perform them.
- **FR-12 (Model tiering).** When tiers are configured, dispatch model overrides must follow the `kind`/`complexity` gate and pass configured values verbatim.
- **FR-13 (Result handling).** The orchestrator must handle `ready` (validate, verify, integrate), `blocked` (stop dependents, preserve worktree, report), and `halted` (never re-dispatch; go to halt-finalize), and must treat malformed/missing results as blocked, never optimistically commit.
- **FR-14 (Finalize gate).** No intent closes until the full `verification.finalize` gate (plus any per-item `finalize_check` invariants) passes on the integrated tree.
- **FR-15 (Ship).** On `auto-close`, finalize must merge into the base branch, tear down the worktree and its spawned processes, and push; on `merge-request`, it must push the intent branch and open one MR as the sole review gate.
- **FR-16 (Concurrency safety).** Other sessions' worktrees, branches, and intents must never be merged, removed, killed, or blocked on by a run that does not own them.
- **FR-17 (Budget halt, optional).** When halt config is present, a gated builder must write a halt-note and return `halted`; the orchestrator must write an intent-handoff, wait for reset, then resume halted/pending items.

## 7. UX / workflow

The operator's journey is two explicit commands and (at most) two decision points:

1. **Plan.** `/specsmd-inferno-planner` → answer the planner's clarifying questions. Under `production` mode (the default) this is a staged deep-intake questionnaire — core questions, then a mandatory deep-dive across functional edge cases, error handling, data/storage, integrations, and NFRs, then a full summary approval; under `autonomous` mode it's one lean, open-ended pass. The planner writes the artifacts and stops. Under `production` it then surfaces a single, focused "worth a look before you build" block (open questions, risky assumptions, deferred items) — not a per-item dump. Under `autonomous` it stops silently with no pause.
2. **Build.** `/specsmd-inferno` → pick the intent from the menu (or pass it on invocation). The orchestrator claims it, builds the whole intent in parallel, verifies, and ships. During the run it reports dispatch and integration *facts*, not worker reasoning.
3. **Close.** A short, plain-language summary of what was built for the application, the merge/push status, and — only if any occurred — the real problems hit and how they were resolved.

The deliberate design choice: **the decision points are front-loaded.** Everything that needs a human is surfaced once, after planning. The build itself is hands-off.

## 8. Configuration & extensibility

All configuration lives in an optional `.specs-inferno/config.yaml`; every key is optional and falls back to host/project defaults. `npx specsmd install` scaffolds it interactively at install time (mode, model tiers, finalize verification — defaulting sanely on Enter); this is the primary creation path. `/specsmd-inferno-config` is the create-or-edit command for reviewing or changing it afterward (e.g. switching mode mid-project), and it also serves as the planner's fallback display-and-confirm gate on a first run where the file is still absent.

| Key | Purpose | Fallback |
|---|---|---|
| `models.strong` / `models.cheap` / `models.writer` | Worker model tiers for the complexity gate and scribes. | No per-dispatch override; host default model. |
| `verification.finalize` | Ordered shell commands forming the authoritative finalize gate. | Standard production build + full test suite discovered from the repo. |
| `mode` | Top-level `production` (staged deep intake, one review pause) or `autonomous` (lean intake, no pause); also sets the delivery default. A pre-`mode` config's legacy key still maps onto it — see FR-7. | `production`. |
| `delivery.mode` / `delivery.base_branch` | `auto-close` (local merge + push) or `merge-request` (forge-aware review MR); and the branch to merge into. | Derived from `mode` (`production` -> `merge-request`, `autonomous` -> `auto-close`); `merge-request` when both `mode` and `delivery.mode` are absent. Base branch: the intent's base branch, confirmed at finalize. |
| `halt.flag_file` / `halt.wait_script` | Budget-cap halt integration. | Halt gate skipped; a `halted` builder pauses for manual resume. |
| `knowledge.index` | Path to a project knowledge-base index builders walk first. | Standard search. |

**Delivery modes** are the main extensibility seam: `auto-close` is `autonomous` mode's default; `merge-request` is `production` mode's default (and the overall default when `mode`/`delivery.mode` are both absent) and inserts a single human review gate at the end — it is forge-aware (`gh` / `glab`), degrading gracefully to "report the MR to open manually" when neither is present.

## 9. Success metrics

**Operational metrics (per intent):**

- **Wall-clock to verified close**, and the ratio of wall-clock to total builder work (lower = parallelism is paying off).
- **Realized parallelism width** = max concurrent builders the run actually dispatched.
- **Edit-collision / `blocked` rate** — must stay near zero; a non-trivial rate means ownership was misreported or decomposition was too coarse.
- **Finalize-gate pass rate on first try.**
- **Re-dispatch / malformed-result rate** (the silent-stall failure mode).

**Quality metrics (validated against human-paced flows):**

- **Caveat-survival rate** in builder-facing docs — target 100%; this is a hard gate.
- **Spec fidelity** — does the build deliver the written acceptance criteria, without silent descope?
- **Test coverage** of load-bearing rules, written test-first.

**Evidence from internal evaluations.** In a blind, multi-judge head-to-head on a real brownfield codebase, an INFERNO build driven *only* by flattened work items (real TDD-gated builders) was competitive with a doc-heavy serial alternative and **more faithful to the written acceptance criteria** — winning decisively on testability (dozens of meaningful DB-free unit tests vs a handful) and spec fidelity, while trailing on idiom polish and one concurrency-hardening path. Critically, switching from generic agents to the canonical TDD-gated builder **eliminated a phantom-schema defect** that would have broken every insert at runtime. The doc-bloat of the heavy alternative bought neither correctness nor fidelity. These results motivated two flow gates now recommended for adoption: an **idiom/lint `finalize_check`** and a **contract/DB-in-CI test** for resolution logic that a no-DB run can't catch.

## 10. Risks, trade-offs & open questions

- **R1 — Caveat loss is the dominant failure mode.** A lean, link-only work item that hides a load-bearing caveat behind an unresolved link produces a confidently-wrong build. In internal evaluations a pointer-only shape failed the caveat gate every time, once producing an outright **hollow** build (green tests, zero real field mappings). *Mitigation (in force):* the planner must inline every caveat into the work item, not merely link it, and the caveat-survival check must pass before any item is written. This is FR-5 and is non-negotiable.
- **R2 — Under-realized parallelism.** A naive 1:1 story→item decomposition tends to give every item overlapping ownership of a shared surface, which the scheduler correctly serializes — collapsing parallelism toward serial. In one evaluation a 10-item, 2-unit intent ran only 2-wide. *Mitigation / open question:* dependency-aware "chop" decomposition (extract the shared surface into a front-loaded foundation item, then give leaves disjoint ownership) is a forward-looking, opt-in experiment; it must gate on the collision rate staying near zero before it becomes default.
- **R3 — No mid-build human gate.** This is the point of the flow, but it means a wrong up-front decision is only caught at finalize. *Mitigation:* `production` mode's review pause and the cross-intent reconciliation step front-load the decisions that matter; the verified finalize is the backstop.
- **R4 — Model-tier misconfiguration.** Down-tiering a reasoning-bearing item to a cheap model can produce fabricated `ready` results. *Mitigation:* the gate defaults `medium`+ items to the strong tier and never down-tiers on a hunch; misconfig surfaces in the report.
- **R5 — Concurrency hazards.** Multiple sessions on one repo. *Mitigation:* claim-on-select locking, one-worktree isolation, serialized state, and a hard rule never to touch another session's worktree.
- **Open — Idiom/lint and resolution-layer gates.** Folding the recommended `finalize_check` idiom gate and a resolution-layer contract test into the default verification is the remaining step before INFERNO reaches full parity with human-paced flows on the dimensions it currently trails.
