---
intent: production-mode-and-deep-intake
scope: src/flows/inferno, src/flows/aidlc-turbo, src/lib/installer.js, evals/install-eval.sh
status: approved-provisional
---

# Requirements — Production/autonomous modes, deep intake questioning, and install-time INFERNO config

Written scope for the intent. Provisionally approved (Ruben AFK; recommended options
recorded in the brief's Notes). Decomposition covers exactly this — no more, no less.

## Functional requirements

- **FR-1** — `.specs-inferno/config.yaml` gains a top-level `mode:` key with values `production | autonomous`; it replaces `autonomy.level` in the documented schema (config.example.yaml, wizard command, planner/orchestrator agents, README, PRD).
- **FR-2** — `mode: production` ⇒ planner runs the staged deep questionnaire during intake, pauses exactly once after writing work items (current `review` behavior), and delivery defaults to `merge-request`.
- **FR-3** — `mode: autonomous` ⇒ planner keeps the current lean intake, no post-write pause (current `full` behavior), and delivery defaults to `auto-close`.
- **FR-4** — An explicit `delivery.mode` key overrides the mode-derived delivery default in both modes.
- **FR-5** — Legacy compatibility: when `mode` is absent but `autonomy.level` is present, `review` maps to `production` and `full` maps to `autonomous`; when both are absent, behave as `production` (matches today's default of `review`).
- **FR-6** — Production intake questionnaire (INFERNO planner intent-capture + decisions-capture): stage 1 core questions (users, outcomes, constraints, success measure, top concern) → stage 2 mandatory deep-dive round probing edge cases, error handling, data, integrations, and NFR territory (performance, security, reliability) → stage 3 full summary approval, before decomposition. Autonomous mode skips stages 1–3 pauses and keeps the existing open-ended flow.
- **FR-7** — AI-DLC Turbo requirements skill: after the existing 5 clarifying questions, a mandatory second interrogation round (edge cases, error handling, data, integrations, NFR probing) before generating requirements.
- **FR-8** — AI-DLC Turbo decisions-and-gates skill absorbs the system-boundary/integration questions that full-mode `context` used to ask, as ledger inputs — without reintroducing a system-context document.
- **FR-9** — `npx specsmd install`, when the INFERNO flow is selected, asks the config questions (mode, strong/cheap/writer model tiers, finalize verification commands) using the existing `prompts` library and writes `.specs-inferno/config.yaml` into the target repo.
- **FR-10** — Every new install prompt has a sensible pre-selected default so plain Enter accepts it; a non-interactive/aborted prompt run still writes the default config rather than failing the install.
- **FR-11** — The install next-steps message names the selected flow's real entry command (INFERNO → `/specsmd-inferno-planner`) instead of the hard-coded `/specsmd-master-agent`.
- **FR-12** — `/specsmd-inferno-config` is retained and repositioned as the way to CREATE-OR-EDIT config after install; the planner's first-run config gate stays as a fallback and speaks the new schema.
- **FR-13** — `evals/install-eval.sh` is updated to drive the new prompts and asserts `.specs-inferno/config.yaml` exists in the sandbox after an INFERNO install.
- **FR-14** — README.md and PRD.md for the inferno flow document the consolidated `mode` vocabulary and install-time config.

## Non-functional requirements

- **NFR-1** — All existing vitest suites and markdown lint pass; builder/writer parity tests and the FIRE-namespace test remain green without modification.
- **NFR-2** — New installer behavior is covered by a new vitest suite (no installer tests exist today).
- **NFR-3** — Flow files stay portable: no project- or machine-specific values hardcoded in `.specsmd/`-shipped content.

## Out of scope

- Renaming or reworking FIRE, classic AI-DLC (non-turbo), ideation, or simple flows.
- Changing the builder or writer agents/commands in any way.
- Changing orchestrator dispatch, halt/budget behavior, or worktree mechanics beyond the delivery-default lookup.
- Migrating existing consumer repos' config files (only documented mapping, no codemod).
- Pushing to origin / publishing (hard gate: held until Ruben tests).
