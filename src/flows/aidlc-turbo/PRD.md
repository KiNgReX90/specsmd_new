# PRD — AI-DLC Turbo Flow

**Status:** living document · **Owner:** specsmd flow maintainers · **Audience:** flow maintainers, contributors, and operators evaluating which specsmd flow to adopt.

---

## One-page summary

**AI-DLC Turbo is the slim variant of the AI-DLC flow — same process, far less documentation.** It runs the same three-phase shape (Inception → Construction → Operations) and the same Domain-Driven Design construction stages as AI-DLC; what gets lighter is the documentation, not the method. It **drops the boilerplate planning documents** (system-context, impact-analysis, verbose per-unit briefs, inception-log) and replaces them with a single **decisions-and-gates ledger**: the load-bearing reasoning the build will turn on, written *once* and linked to, never restated across a dozen files. There are no bolts in the default path — units and their stories drive construction directly.

- **Problem it solves:** full AI-DLC produces a large stack of planning prose in which the same load-bearing fact is restated many times. The bloat is a **restatement problem**, not a "too much thinking" problem — it inflates review burden and token cost without improving the build. AI-DLC Turbo cuts the volume while keeping the decisions that actually matter.
- **Target user:** a developer or team who wants AI-DLC's structured, human-validated planning and DDD discipline, but without the document overhead — and who reviews the plan themselves before building.
- **The core bet:** you can cut the majority of planning-doc volume **without losing build quality**, as long as every caveat is written once as a first-class, build-rule-bearing item and linked, rather than restated (heavy) or dropped (naive lean).
- **Headline capabilities:**
  1. A **lean inception pipeline** — requirements → decisions-and-gates ledger → lean units → stories → review — with auto-continue between steps and only four human checkpoints.
  2. A single **decisions-and-gates ledger**: open questions/caveats (each with a status and an explicit build rule), dated decisions, and release gates, as the one source the build reads.
  3. **DDD construction per unit** (model → design → implement → test), honoring every caveat in the ledger, with no bolt boilerplate.
  4. A **vibe-to-spec** on-ramp that turns a prototype (screenshots, HTML, Figma, PDF) into formal specsmd artifacts.
  5. **Standards-driven** code generation (tech stack, coding standards, architecture) and an Operations phase (build, deploy, verify, monitor).
  6. A **full legacy mode** retained as an opt-in escape hatch for projects that still want bolts and full briefs.

**Evidence (internal head-to-head evaluations, three runs across two production codebases on different stacks, blind multi-judge panel, build-quality scored 0–10):** the AI-DLC Turbo doc shape was the **robust cross-run default** — consistently strong (roughly 8.1–8.6 of 10) across every run where it was built, cutting roughly **65–91% of planning-doc volume while matching or beating the heavy AI-DLC control on build quality**. The heavy control was Pareto-dominated in two of three runs; its extra documents bought neither correctness nor fidelity. At the same time, the *opposite* extreme — a pointer-only shape that hides caveats behind links — gate-failed every run. AI-DLC Turbo sits at the sweet spot: lean enough to cut review burden, structured enough to keep caveats safe.

---

## 1. Problem & context

specsmd's full AI-DLC flow implements the AI-DLC methodology faithfully: concentrated rapid planning, DDD-driven construction, persistent memory-bank context, and human validation at every step. It works — but its planning output is heavy. Audited on a real intent, the heavy flow emitted dozens of files and thousands of lines of planning prose, of which roughly a third was **pure restatement**: the same load-bearing fact ("big-bang, no feature flag"; a specific column swap) repeated seven to eleven times across separate documents.

That restatement has three costs:

1. **Review burden.** A human has to read all of it to approve a change, even though most of it is duplication.
2. **Token cost.** Generating and re-sending the prose is expensive.
3. **Drift risk.** When the same fact lives in many places, the copies fall out of sync.

The naive fix — aggressively summarize and link — has its own trap: **lossy re-summarization drops caveats.** If a load-bearing caveat survives only as a bare field with no build rule, the build can confidently reinvent a defect the original planning had specifically warned against.

AI-DLC Turbo is the calibrated middle: keep AI-DLC's decision quality, write each load-bearing fact **once** as a first-class item with an explicit build rule, and link to it from the stories and from construction. It is the *slim* variant — lean by default — with the full legacy pipeline retained only as an opt-in escape hatch.

## 2. Target users & use cases

**Primary user:** a developer or team that values structured, human-validated planning and DDD construction discipline, but finds full AI-DLC's document output excessive — and who wants to read and approve the plan before any code is written.

**Strong-fit use cases:**

- Feature work with **real domain logic** (business rules, edge cases, resolution math) where DDD modeling pays off but a 30-file planning bundle does not.
- Brownfield changes with **load-bearing caveats** (a forward-only rule, a rounding mode, a column that does/doesn't exist) that must be captured precisely and honored during the build.
- Teams migrating off full AI-DLC who want the lowest-friction path to a leaner shape — same structure, fewer documents.
- Prototype-first projects: a vibe-coded mockup exists and needs to become formal specs before construction.

**Poor-fit use cases:**

- Fully autonomous, unattended parallel builds with no per-step human review — that is INFERNO.
- Throwaway scripts or single-file changes where any structured inception is overhead.

## 3. Goals & non-goals

**Goals**

- G1. **Preserve AI-DLC's planning quality** — decisions, caveats, DDD modeling — while cutting planning-doc volume by a large margin.
- G2. **Write each load-bearing fact once** in a single ledger, and link to it; never restate across files.
- G3. **Guarantee caveat survival**: every caveat carries a status and an explicit build rule, and open questions the evidence does not settle are recorded `OPEN`, never silently resolved.
- G4. **Keep the human in the loop** at a small number of meaningful checkpoints, with auto-continue in between.
- G5. **Stay one decision away from full AI-DLC** — full mode is an opt-in escape hatch, not a rewrite.

**Non-goals**

- N1. AI-DLC Turbo is **not** autonomous or parallel. Construction is per-unit and human-validated. (INFERNO is the autonomous/parallel flow.)
- N2. It does **not** use bolts in the default lean path. Stories drive construction directly through the DDD stages.
- N3. It does **not** keep the boilerplate planning documents (system-context, impact-analysis, verbose unit briefs, inception-log) in lean mode — that volume is exactly what it exists to cut.
- N4. It is **not** a capability-accumulation system with durable, long-lived per-capability specs. It is a feature-batch flow scoped to an intent.

## 4. Value proposition

**Versus full AI-DLC:** the same three phases, the same DDD construction stages, the same human-validation philosophy — but a fraction of the documents. In internal evaluations the lean shape matched or beat the heavy control on built-code quality while cutting roughly two-thirds to nine-tenths of the planning volume; the heavy control was Pareto-dominated. For most teams this is a strict improvement: less to write, less to review, less to drift, and at least as good a build.

**Versus a naive "just summarize the docs" approach:** AI-DLC Turbo's leanness is *structured*, not lossy. The decisions-and-gates ledger forces every caveat to be a first-class item with a build rule, and stories link to it rather than paraphrasing it. That is what keeps the slim shape safe where pointer-only shapes fail.

**Versus INFERNO:** AI-DLC Turbo keeps a human reviewing the plan and steering construction per unit. It is the right flow when you want lean planning *with* oversight, rather than autonomy.

## 5. How it works

### Phases & surfaces

| Command | Role |
|---|---|
| `/specsmd-aidlc-turbo` | **Master orchestrator** — analyzes project state and routes to the right phase; runs `project-init` for new projects. |
| `/specsmd-aidlc-turbo-inception` | Inception phase — requirements, decisions-and-gates ledger, lean units, stories, review. |
| `/specsmd-aidlc-turbo-construction` | Construction phase — build a unit's stories through the DDD stages. |
| `/specsmd-aidlc-turbo-operations` | Operations phase — build, deploy, verify, monitor. |

All artifacts live under `.specs-aidlc-turbo/`; the memory bank persists context across stateless agent sessions. The authoritative artifact schema is `.specsmd/aidlc-turbo/memory-bank.yaml`.

### Inception (lean by default)

The pipeline is **requirements → decisions-and-gates → (lean) units → stories → review**, with auto-continue between skills and only four checkpoints:

- **Checkpoint 1** — clarifying questions answered.
- **Checkpoint 2** — requirements approved.
- *(auto-continue: decisions-and-gates → lean units → stories)*
- **Checkpoint 3** — all generated artifacts reviewed.
- **Checkpoint 4** — ready for construction.

The **decisions-and-gates ledger** is the heart of the flow. It captures, once:

- **Caveats / open questions** — each with an id, a status (`OPEN` | `resolved`), and an explicit **build rule** stating what to do or not assume. A caveat with no build rule is useless. Questions the evidence does not settle are recorded `OPEN` with a conservative rule, never silently resolved.
- **Dated decisions** — the choice, a one-line rationale (citing the code when the code is leading), and status.
- **Release gates** — the hard conditions that must hold before the intent can ship.

Stories reference the ledger by link; construction reads it before each unit. In lean mode, **units** are minimal grouping stubs (id/label + scope/ownership hint), not full multi-section briefs — there is no system-context document and no bolt plan.

### Construction (DDD stages, per unit, no bolts)

The construction agent reads the decisions-and-gates ledger first, then builds a unit's stories through the DDD stage playbook — **model → design → implement → test** — honoring every caveat that governs the stories in scope and never silently resolving an `OPEN` one. Before a unit is marked done, the relevant release gates must pass. There are no bolt files in lean mode; if a unit has no stories, the agent redirects to story authoring, never to bolt planning.

### Vibe-to-spec on-ramp

For prototype-first projects, `vibe-to-spec` converts screenshots / HTML exports / Figma / PDF mockups into a screen inventory, an extracted design system, a component catalog, user flows, and derived requirements — which then feed the standard inception pipeline.

### Full mode (legacy escape hatch)

Resolved only by an explicit `--mode=full` / `--full` arg, a config key, or the presence of planned bolts. Full mode restores the legacy pipeline (requirements → context → units → stories → bolt-plan → review), full unit briefs, the system-context document, and bolt-based construction. It exists for projects that still want it; it is never the default.

## 6. Functional requirements

Numbered and testable.

- **FR-1 (Lean default).** Inception must run in lean mode unless full mode is explicitly selected by arg, config key, or the presence of planned bolts.
- **FR-2 (Boilerplate dropped in lean).** Lean mode must not produce system-context, impact-analysis, verbose unit briefs, inception-log, or bolt instances.
- **FR-3 (Single ledger).** Lean inception must produce exactly one `decisions-and-gates.md` per intent, fusing caveats/open questions, dated decisions, and release gates.
- **FR-4 (Build rule per caveat).** Every caveat row must have an id, a status, and a non-empty build rule.
- **FR-5 (No silent resolution).** An open question the evidence does not settle must be recorded `OPEN` with a conservative rule, never silently resolved.
- **FR-6 (Write-once / link).** Stories and construction must reference the ledger by link rather than restating its facts.
- **FR-7 (Auto-continue).** Between decisions-and-gates → units → stories → review, the agent must proceed without asking for confirmation; it must stop only at the four defined checkpoints.
- **FR-8 (Lean units).** In lean mode, units must be minimal grouping stubs, not full multi-section briefs.
- **FR-9 (No bolts in lean).** Construction must build per unit driven by stories; it must never create bolt files or redirect to bolt planning in lean mode.
- **FR-10 (Ledger honored at build).** Construction must read the decisions-and-gates ledger before building a unit and honor every governing caveat; it must not silently resolve an `OPEN` caveat.
- **FR-11 (Release gates).** Before a unit is marked done, the relevant release gates from the ledger must be confirmed to pass.
- **FR-12 (DDD stages).** Construction must follow the DDD stage playbook (model → design → implement → test) as defined, executing rather than inventing the workflow.
- **FR-13 (Vibe-to-spec).** Given a prototype folder, the flow must produce a screen inventory, design system, component catalog, user flows, and derived requirements feeding standard inception, with the three defined checkpoints.
- **FR-14 (Standards-driven).** `project-init` must capture project type and standards (tech stack, coding standards, optional architecture) that all agents load as context.
- **FR-15 (Full-mode escape hatch).** Full mode must remain reachable and, when selected, restore the legacy pipeline (context, full briefs, bolt-plan, bolt-based construction).
- **FR-16 (Stateless agents / memory bank).** Agents must read all context from the memory bank at startup; artifacts must persist across sessions under `.specs-aidlc-turbo/`.

## 7. UX / workflow

The operator's journey keeps the human as the validation "loss function" at a small number of points, with the agent driving the rest:

1. **Initialize** (once per project) — `/specsmd-aidlc-turbo` → `project-init`: pick a project type and set standards.
2. **Inception** — `/specsmd-aidlc-turbo-inception`: answer clarifying questions (Checkpoint 1), approve requirements (Checkpoint 2); the agent then auto-generates the decisions-and-gates ledger, lean units, and stories; review all artifacts (Checkpoint 3) and confirm ready for construction (Checkpoint 4).
3. **Construction** — `/specsmd-aidlc-turbo-construction --unit="..."`: the agent reads the ledger, builds the unit's stories through the DDD stages, validates at each stage, and confirms release gates before marking the unit done.
4. **Operations** — `/specsmd-aidlc-turbo-operations`: build, deploy, verify, monitor.

The design intent: **fewer, higher-value checkpoints.** The human reviews requirements and the assembled artifact set, not every intermediate document; the agent never builds a unit it wasn't told to.

## 8. Configuration & extensibility

- **Inception mode** — `lean` (default) or `full`, resolved by arg (`--mode=full` / `--lean`), then config (`inception.mode` in `context-config.yaml` under `agents.inception`), then default lean.
- **Standards** — `project-init` writes tech-stack, coding-standards, and optional architecture/UX/API standards to `.specs-aidlc-turbo/standards/`; agents load them as context for all code generation.
- **DDD stage playbook** — construction is playbook-agnostic; stage definitions are read from `templates/construction/bolt-types/{playbook}.md`, so the construction workflow can be extended or swapped without changing the agent.
- **Memory-bank schema** — `.specsmd/aidlc-turbo/memory-bank.yaml` is the authoritative source for where artifacts live; agents read it rather than hardcoding paths.
- **Validation scripts** — `artifact-validator`, `bolt-complete`, and `status-integrity` keep artifact state consistent.

## 9. Success metrics

**Doc-economy metrics (objective):**

- **Planning-doc volume** (files and lines) per intent — target a large reduction versus full AI-DLC.
- **Restatement ratio** = mentions of load-bearing facts ÷ distinct facts — target near 1 (each fact written once).
- **Review-diff size** — lines a human must read to approve one change.

**Quality metrics (validated, not assumed):**

- **Caveat-survival rate** in the builder-facing artifact — target 100% (hard gate).
- **Build quality** — correctness, spec fidelity, robustness, testability, idiom fit, maintainability — at parity with or better than full AI-DLC on equal scope.

**Process metrics:**

- **Number of human checkpoints / decisions surfaced** for sign-off.
- **Time-to-first-approve** of a plan.

**Evidence from internal evaluations.** Across three head-to-head runs on two production codebases (different languages and stacks), with the documentation shape as the only variable and a single canonical TDD-gated builder constructing every arm, the AI-DLC Turbo shape was the **robust cross-run default**: it scored roughly 8.1–8.6 (of 10) on a blind multi-judge build-quality panel while cutting roughly 65–91% of planning-doc volume, and it **Pareto-dominated or tied** the heavy AI-DLC control — which was itself dominated in two of three runs. The decisions-and-gates ledger (write-once, caveats as first-class, link-don't-restate) is the structural mechanism behind that result: a cheap, build-less analysis stage predicted the eventual build defects from the doc shape alone. The standing recommendation from those evaluations is to fold two gates into the flow so no build can regress them: an **idiom/lint gate** and a **caveat-inline check**.

## 10. Risks, trade-offs & open questions

- **R1 — Lossy slimming is the failure mode to avoid.** The danger of any slim flow is dropping a caveat by re-summarizing. In internal evaluations, a pointer-only shape that hid caveats behind links failed the caveat gate every run, once producing a hollow build. *Mitigation (in force):* the decisions-and-gates ledger requires every caveat to carry an explicit build rule and forbids silent resolution of open questions (FR-4, FR-5); stories link to the ledger rather than paraphrasing it (FR-6).
- **R2 — Inherited-bloat creep.** Because AI-DLC Turbo shares heritage with full AI-DLC, documentation and templates can drift back toward the heavy document set. *Mitigation:* lean mode is the default and explicitly enumerates the documents it drops; full mode is the only place that heavy set lives.
- **R3 — "Keep-and-trim" inherits source defects.** Trimming the heavy docs can carry forward a latent defect that was already in them (e.g. a rule contradicted by its own example SQL). *Mitigation / open question:* re-expressing a caveat as an explicit build rule (rather than copying inherited prose) catches such latent bugs; an idiom/lint and caveat-inline gate are recommended for adoption.
- **R4 — Human-paced by design.** AI-DLC Turbo does not parallelize or run unattended. For large, decomposable intents where throughput matters more than per-unit review, this is a limitation by design — INFERNO is the answer there, and the `inception-to-inferno` bridge can hand a completed AI-DLC intent to INFERNO for parallel construction.
- **Open — Direction of travel.** The same evaluations point to a delta + scenario (capability-accumulation) discipline as a promising evolution where load-bearing facts become first-class testable scenarios and durable per-capability specs accumulate over time. Whether and how to fold that into AI-DLC Turbo — versus keeping it a separate flow — is an open packaging question to decide after the gates above are in place.
