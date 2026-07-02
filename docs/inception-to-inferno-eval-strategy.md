# Inception → INFERNO bridge + flow-comparison eval — strategy

**Status:** design / strategy (not a task list)
**Date:** 2026-06-23
**Author:** Ruben + Claude
**Scope:** (A) a converter that routes AI-DLC inception output into INFERNO intents+work items, dropping units/bolts and keeping user stories as linked context; (B) a multi-arm eval that measures whether that change — and native INFERNO — cut docs and time while holding build correctness and code quality, primarily on the ViewPoint brownfield codebase.

---

## 0. The thesis we are testing

> Routing inception output into INFERNO work items (**A2**), and native INFERNO (**A3**), drastically cut planning + construction docs and wall-clock versus full AI-DLC (**A1**), **while holding build correctness and code quality**. The **A2-vs-A3** gap tells us whether the `/inception-discovery` + `/resolve-inception-docs` + `/specsmd-inception-agent` layer is worth keeping.

**Primary battleground: ViewPoint (brownfield).** ViewPoint is the codebase we work in most — a JDK8 / Maven / Oracle / Tomcat legacy WAR app. A large legacy Java codebase is exactly where the inception layer should earn its keep: discovery maps the existing structure, resolve pins real file targets, glossary/term-mappings bridge domain language. So the headline question is concrete:

> **On ViewPoint, does pre-built discovery context (A2) beat cold exploration (A3)?** Expectation: yes, and the gap widens with difficulty.

Greenfield is reduced to a single throwaway smoke test that proves the harness works before we spend ViewPoint build minutes.

---

## 1. Background — the doc-bloat problem, quantified

The dogfooded AI-DLC intent `011-vscode-extension` produced ≈**37 files before a single line of construction**:

- 1 `requirements.md` + 1 `system-context.md` + 1 `units.md`
- 5 `unit-brief.md`
- 17 story files
- 1 `inception-log.md`
- 6 `bolt.md`
- ~5 project-wide ceremony docs (PRFAQ, glossary, term-mappings, story-index, maintenance-log)

…and construction then adds **3 stage docs per bolt** (`ddd-01-domain-model`, `ddd-02-technical-design`, `ddd-03-test-report`).

The explosion lives in the **unit → bolt → stage** layer. The structural insight that makes the fix clean: **an INFERNO work item already subsumes what AI-DLC spreads across three files.** `unit-brief.md` (scope, assigned reqs, success criteria, deps, tech context) + `bolt.md` (stories, deps, complexity) + the construction design docs collapse into one work item's frontmatter + Execution Manifest + acceptance criteria. So "convert inception → INFERNO" is a **flattening**, not a translation.

### Two distinct doc-reduction wins (do not conflate)

| Win | What is eliminated | Delivered by |
|---|---|---|
| **Construction-side** | all per-bolt stage docs (`ddd-01/02/03`), `bolt.md` | the converter (Phase 1) — immediate |
| **Planning-side** | `units.md`, `unit-brief.md`, bolt authoring | a *lean inception mode* that stops after stories (built as part of this plan, exercised by arm **A4**) |

The converter (arm **A2**) proves units/bolts are **redundant** — the build works fine from stories→work items even while inception still authored them. The lean inception mode (arm **A4**) then never authors them at all, realizing the planning-side reduction. Both are built here; the eval measures each win separately.

---

## Part A — The bridge: `/inception-to-inferno`

### A.1 What it is

A new converter skill/command. Inception runs exactly as it does today; the converter reads a **completed** memory-bank intent and emits INFERNO artifacts. Nothing in the inception flow changes in Phase 1.

**Pipeline:**

```
/inception-discovery → /specsmd-inception-agent → /resolve-inception-docs → /inception-to-inferno → /specsmd-inferno
```

### A.2 The mapping (a flattening)

| AI-DLC artifact | → INFERNO | Notes |
|---|---|---|
| Intent `requirements.md` (goal/users/problem) + `system-context.md` | `.specs-inferno/intents/<id>/brief.md` | actors/externals → constraints / notes |
| **Story** (`stories/NNN-*.md`) | **Work item** (`work-items/<id>.md`) | 1 story ≈ 1 item; tight cohesive clusters may merge |
| Story acceptance criteria (Given/When/Then) | work-item `## Acceptance Criteria` | carried verbatim |
| Story file itself | `context.required` entry | **linked, not re-summarized** — builder reads it verbatim; full traceability; near-lossless |
| Story `depends_on` | work-item `depends_on` | within-intent ordering only |
| **Unit** | `ownership.editable` partition + a grouping label | survives as the editable-path split; **no unit-brief doc emitted** |
| **Bolt** | *discarded* | grouping/complexity/ordering is recomputed natively by INFERNO's dependency-frontier scheduler |
| Unit-brief "technical context" prose | `context.patterns` / `context.tests` targets | needs concrete paths → resolved in the step before (see A.3) |
| Story/unit type | work-item `kind` (`behavior`/`api`/`ui`/`test`/…) and `complexity` | inferred from story type + AC scope |

### A.3 Satisfying the INFERNO work-item contract

INFERNO's orchestrator **validates the contract before dispatch** and refuses to build an item with a thin manifest. Specifically it requires:

- `context.required` — non-empty, real paths with reasons
- `ownership.editable` — non-empty, real paths
- `context.patterns` — required when `kind ∈ {behavior, architecture, api, ui}`
- `context.tests` — required unless `kind ∈ {docs-only, config-only}`

AI-DLC stories carry prose, not concrete file paths. **`/resolve-inception-docs` is the natural place to pin those real paths against the actual ViewPoint codebase** — it already resolves docs against the code. The converter then has concrete targets to emit. If a story can't be resolved to a real editable target, the converter flags it rather than emitting an invalid item.

### A.4 Stories grouped inside intents (your explicit requirement)

Final shape per converted intent:

```
.specs-inferno/intents/<intent-id>/
├── brief.md                         # from requirements + system-context
└── work-items/
    ├── <story-1-id>.md              # AC + manifest; links stories/001-*.md as context.required
    ├── <story-2-id>.md
    └── ...
```

Stories remain first-class **as linked context**, grouped inside one INFERNO intent. No units, no bolts, no construction-stage docs.

---

## Part B — The eval harness

### B.1 The three arms

All arms receive the **identical natural-language intent statement** and **identical model tiers** (the two most important fairness controls).

| Arm | Pipeline | Isolates |
|---|---|---|
| **A1 — AI-DLC full** | discovery → resolve → inception-agent (requirements→units→stories→bolts) → construction agent builds bolts **serially** on a ViewPoint worktree | the status quo |
| **A2 — inception→INFERNO bridge** | discovery → resolve → inception-agent → **`/inception-to-inferno`** → `/specsmd-inferno` **parallel** build on a ViewPoint worktree | dropping units/bolts + parallel build |
| **A3 — INFERNO native** | `/specsmd-inferno-planner` (intent-capture + work-item-decompose, **cold** — no discovery docs) → `/specsmd-inferno` parallel build | the value of the inception layer |
| **A4 — lean inception → INFERNO** | discovery → resolve → inception-agent **stopped after stories** (no units/bolts authored) → **`/inception-to-inferno`** → `/specsmd-inferno` parallel build | the planning-side doc reduction + **the target end-state** |

**Controlled comparisons:**
- **A2 vs A1** → does dropping units/bolts + building in parallel hurt correctness/quality? (expected: no, and it's faster with fewer docs)
- **A2 vs A3** → is the inception discovery/resolve layer worth keeping? (**the product question**)
- **A4 vs A2** → the planning-side doc reduction (units/bolts never authored vs authored-then-discarded)
- **A4 vs A3** → does the *lean* inception layer beat cold INFERNO? (**the shippable keep-inception verdict** — A4 is what we'd ship)
- **A1 vs A3** → the heavy vs light extremes

**Shared-inception fork (recommended optimization).** A1 and A2 share an identical inception front-end (discovery → resolve → inception-agent). Run inception **once**, then fork: A1 continues into bolts/construction, A2 forks into the converter. This makes A1-vs-A2 a clean controlled comparison whose *only* variable is "what happens after stories," and it halves the inception cost. A3 is independent (it has no inception). Run independent inception per repeat only when measuring inception's own variance.

**A4 is the target end-state.** It demonstrates the **full** doc reduction (planning + construction), and it's the flow we'd actually ship: keep the inception discovery/resolve front-end, stop before units/bolts, route straight into INFERNO. A2 still exists as a control that isolates the construction-side win from the planning-side win.

### B.2 The intent set (ViewPoint-first, difficulty-tiered)

| Tier | Where | Description | Stresses |
|---|---|---|---|
| **T0 — greenfield smoke** | toy repo | one tiny lib/function | harness self-test only; **not in the headline result** |
| **T1 — easy** | ViewPoint | isolated change in one module (small endpoint tweak, validation, bugfix) | baseline; A3 cold should cope here |
| **T2 — medium** | ViewPoint | feature touching a few modules with dependencies; must follow existing patterns | dependency ordering, parallelism, convention-matching |
| **T3 — hard** | ViewPoint | cross-cutting feature spanning UI + service + persistence, with architectural decisions and legacy conventions | **where discovery/resolve should dominate** |

T3 is deliberately authored to force the builder to match existing ViewPoint conventions — that's how A2 earns a win over A3 and we *justify* keeping inception rather than assuming it.

### B.3 The correctness oracle — full e2e with Playwright

Per cell, "build correctness" is the **full end-to-end gate**:

```
mvn package (build WAR) → deploy to Tomcat + Oracle → run the intent's frozen Playwright CLI suite
```

- **Each eval intent ships a frozen Playwright spec** that encodes its acceptance criteria as executable browser tests. The spec is authored **once**, is **arm-independent**, and is the same for A1/A2/A3. This is the fair acceptance oracle: every arm's deployed app is driven by the identical suite.
- Build correctness = **Playwright pass rate** (+ "did it build / did it deploy" as preconditions).
- Because the Playwright suite is deterministic and arm-independent, it also serves as the **ground-truth half of spec fidelity** — complementing the LLM judge's code-level fidelity read.
- Deploy uses the `viewpoint-run-linux` machinery (JDK8 + Oracle container + Tomcat + generated `context.xml`). Because cells run **serially**, one provisioned Oracle+Tomcat stack is reused and **redeployed per cell** — no N concurrent stacks.
- **DB reset between cells:** Playwright tests must start from a known seed. The harness resets Oracle to a seed snapshot (or uses transactional rollback / a dedicated schema) before each cell's suite runs.

### B.4 Scoring vector (your four dimensions)

| Dimension | Method | Deterministic? |
|---|---|---|
| **Doc-volume reduction** | planning-artifact file count + token size; **builder context-load tokens per item** (the causal lever — what a builder must read to start) | yes |
| **Build correctness** | full e2e: build → deploy → Playwright pass rate | yes |
| **Code quality** | blind LLM-judge rubric: readability, structure, idiom-fit (ViewPoint conventions), test adequacy | judge panel |
| **Spec fidelity** | deterministic half = Playwright pass rate; judged half = "does the code actually satisfy the original acceptance criteria" | mixed |
| **Performance** | wall-clock per phase (plan→build→verify), total token cost, parallel-build speedup (A2/A3/A4 vs serial A1) | yes |

### B.5 The judge panel (blind)

- **Blind:** before judging, strip arm identity from the code under review — remove `.specs-*` / `memory-bank` dirs, normalize commit messages and branch names. The judge must not be able to tell which arm produced the diff.
- **Panel of N = 3** judges per artifact; **median** score; surface disagreement (high variance = low-confidence score, flag for human look).
- **Frozen judge model id** pinned in config (never the drifting "latest"), fixed rubric, fixed low temperature.
- Judges score the diff against the **original** intent + acceptance criteria — not against the (reduced) planning artifacts, so a leaner flow isn't penalized or rewarded for its own paperwork.
- The judge panel runs **in parallel** within a cell (cheap relative to a full ViewPoint build).

### B.6 Execution model — serial outer loop, manual kick-off

**Hard constraint: cells do not run concurrently.** You kick off one cell at a time to control token spend.

- A **run manifest** enumerates every cell: `(intent_id, tier, arm, repeat_n)`.
- A **run-one command/script** executes exactly **one** cell when you invoke it, writes its result to a persistent store (`evals/flow-compare/results/<intent>-<arm>-<n>.json`), and prints the **next pending cell** so you know what to kick off next.
- A **report command** reads all results on disk and renders the matrix/report — runnable at any time, even with the matrix only partially complete.
- The **only** parallelism is intra-cell: INFERNO's native parallel builders (bounded by the dependency frontier) and the judge panel (3 judges). Neither fans out the expensive outer loop.

This reconciles "teams of subagents and judges in parallel" (true *inside* a run) with "let me kick them off one by one" (the expensive matrix is serialized).

### B.7 Fairness controls (non-negotiable)

- Identical source intent statement across arms.
- Identical model tiers across arms.
- Blind judging (strip arm identity).
- Frozen judge model id + rubric + temperature.
- Same Playwright suite + same finalize/verification command across arms.
- N ≥ 3 repeats on the headline tier (agent runs are nondeterministic — report variance / confidence, never single points).
- Shared-inception fork for A1-vs-A2 to isolate the post-stories variable.

### B.8 Infra, isolation, and cost discipline

- Each (arm × intent) gets its own ViewPoint **git worktree** so arms don't collide on the source tree.
- **Warm shared caches:** a shared Maven local repo and Docker layer cache so we don't re-download the world per cell. Build *artifacts* isolated; dependency cache shared read-mostly.
- **Do not stomp the dev environment.** The eval must use its own Tomcat port / Oracle instance distinct from your normal ViewPoint dev stack (or run when you're not actively developing). Per CLAUDE.md, any process teardown is scoped to the eval's own worktree/ports — never blanket-kill shared toolchain processes.
- **Serial reuse:** one provisioned Oracle+Tomcat stack, redeployed per cell, reset to seed between cells.
- Sequence: T0 greenfield smoke first (validates the runner cheaply) → then ViewPoint tiers; full deploy + Playwright on every ViewPoint cell; N≥3 repeats only on the headline tier.

---

## 2. Metrics & report

The report renders, per tier, per arm (averaged over repeats with variance):

1. **Doc reduction** — % fewer planning files / tokens vs A1, and **builder context-load tokens per item** (the headline number that explains *why* leaner is faster).
2. **Build correctness** — Playwright pass rate; build/deploy success.
3. **Code quality** — median judge score + disagreement.
4. **Spec fidelity** — Playwright pass rate (deterministic) + judged fidelity.
5. **Performance** — wall-clock per phase, total tokens, parallel speedup.

**Headline views:**
- A scatter of **doc-reduction vs quality-delta** (does cutting docs cost quality?).
- A **per-tier A4-vs-A3 table** (does the *lean* inception layer's advantage grow with difficulty? — the shippable keep-inception verdict), with A2-vs-A3 alongside as a control.
- A **performance bar** (parallel A2/A3/A4 vs serial A1).

---

## 3. Build phasing (the plan)

Phased so each stage is independently useful and the expensive eval is only built after the cheap converter exists.

1. **Bridge converter — `/inception-to-inferno`.** The mapping skill + work-item/brief templates + contract validation (refuse to emit an item that fails the INFERNO contract; flag unresolved stories). Highest leverage; unblocks A2 and A4. *This is itself an INFERNO change → dogfood it as an INFERNO intent.*
2. **Lean inception mode.** An inception mode that stops after stories — never authors `units.md`, unit-briefs, or bolts. Enables arm **A4** (the target end-state). *Also an INFERNO/specsmd flow change → dogfood it.*
3. **Eval fixtures.** The tiered ViewPoint intent set (identical source statements) + one greenfield smoke + per-intent **frozen Playwright specs** + a ViewPoint seed dataset + reset step.
4. **Eval runner (serial, manual kick-off).** Extend `evals/e2e/` into the 4-arm runner: `run-one <intent> <arm> <n>` executing a single cell, persisting JSON, printing the next pending cell. Deterministic metric collectors (doc-volume, perf parsers, build/deploy/Playwright asserter built on the `viewpoint-run-linux` machinery).
5. **Judge layer.** Blind-prep (strip arm identity), rubric, 3-judge parallel panel on a frozen model, aggregation, and the `report` command.
6. **Run the matrix + read results.** Kick cells off one by one; render the report incrementally; draw the keep-inception / doc-reduction conclusions.

---

## 4. Setup prerequisites & open implementation questions

These are needed before Phases 2–3 and are parameters, not blockers:

- **ViewPoint clone path / repo URL** — supplied to the harness via env var; the runner makes per-cell worktrees from it.
- **Playwright against ViewPoint** — Node + Playwright installed; confirm a browser can drive the deployed ViewPoint UI and that we can author per-intent specs (server-rendered WAR is fine for browser-level e2e).
- **Oracle seed strategy** — a known seed snapshot + a fast reset between cells (snapshot restore vs transactional rollback vs dedicated schema).
- **Token/cost capture** — how to read per-run token usage (e.g. `claude -p` stream JSON) for the performance dimension.
- **Existing ViewPoint test coverage** — if there's a usable unit/integration suite, fold it into the gate alongside Playwright.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Agent nondeterminism makes single runs misleading | N≥3 repeats on the headline tier; report variance, not points |
| Judge bias toward a flow's style | blind judging; frozen model; panel + disagreement surfacing |
| ViewPoint build/deploy flakiness inflates "incorrect" | separate build/deploy preconditions from Playwright pass rate; retry deploy once; log infra failures distinctly from real test failures |
| Heavy per-cell cost blows token/compute budget | serial outer loop with manual kick-off; warm caches; one reused runtime |
| Converter emits thin manifests that fail the INFERNO contract | resolve concrete paths in `/resolve-inception-docs`; converter validates and flags unresolved stories instead of emitting invalid items |
| Over-reduction quietly drops correctness | spec fidelity is partly deterministic (Playwright) — over-reduction shows up as failing e2e, not just a judge opinion |
| Eval stomps the live ViewPoint dev stack | dedicated ports/instance; teardown scoped to the eval's own worktree per CLAUDE.md |

---

## 6. Additional tips (consolidated)

- **Blind judging is the difference between a credible result and a vibe.** Strip arm identity before any judge sees the code.
- **Make "builder context-load tokens per item" the headline doc metric** — it's the causal lever that explains *why* a leaner flow is faster and often better, not just "fewer files."
- **Freeze the judge model id** in config; never let it ride the drifting "latest," or your scores aren't comparable across weeks.
- **Keep the source intent statement byte-identical across arms** — the single most important fairness control.
- **Let the Playwright suite be the acceptance oracle**, authored from the original AC and frozen. It makes spec fidelity partly objective and catches over-reduction that judges might miss.
- **Don't fake parallelism.** A1's serial construction is a real disadvantage — measure it honestly rather than "fixing" it for the comparison.
- **Separate the two doc-reduction wins** — construction-stage docs are killed by the converter (measured by **A2**), planning-stage docs by the lean inception mode (measured by **A4**) — so each win is attributed to the change that actually delivered it.
- **Stories as `context.required` links, not re-summaries** — the conversion is near-lossless and cheap, and the builder reads the story verbatim.
- **Design T3 to specifically stress ViewPoint conventions** — that's how A2 earns its win over A3 and the "keep inception" conclusion is *earned*, not assumed.
- **Run T0 greenfield smoke first** every time you change the harness — validate the runner cheaply before burning ViewPoint build minutes.
