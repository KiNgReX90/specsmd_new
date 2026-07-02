# Doc-Slimming Eval Framework

**Date:** 2026-06-24
**Status:** design / eval plan (to run; decisions follow the data, not opinion)
**Origin:** Ruben's ask — find a way to slim AI-DLC's document output (and/or a fusion
"AI-DLC turbo") so we generate fewer docs / fewer tokens while keeping the same build quality.
**Companions:** `A2-btw-real-builder-vs-aidlc-verdict.md` (the head-to-head that motivated this),
`inferno-converter-granularity-idea.md` (the parallelism/decomposition angle, folded into TP-4).

---

## 0. Problem, hypothesis, and method

**The pain (measured, not felt).** On the BTW intent, the AI-DLC flow emits **29 files /
~3,454 lines** of planning prose; the lean INFERNO equivalent is **11 files / ~661 lines**. An
evidence audit of the AI-DLC tree found **~1,100 lines (~32%) are pure ceremony** — the same
load-bearing fact is restated 7-11 times (e.g. "big-bang, no feature-flag" appears 7+ times;
the `btw_verkoop_yn='Y'` swap ~11 times). The bloat is fundamentally a **restatement problem**,
not a "too much thinking" problem.

**The non-obvious risk.** Lean re-summarization is **lossy**: when INFERNO flattened the AI-DLC
stories into work-items it **dropped the OQ-012 caveat** ("no DB column for `type` exists — confirm
with data specialist"), flattening it to a bare "type (verplicht)". The real build avoided a phantom
`NOT NULL` column **only** because the work-item linked back to the source story via
`context.required`. So naive slimming can be both cheaper *and* more dangerous.

**Hypothesis.** We can cut planning-doc volume ~50-90% **without** losing build quality by writing
each fact once and **linking / delta-ing rather than restating**. The candidate "AI-DLC turbo" is a
fusion: keep AI-DLC's *inception decisions* (its quality edge), persist them in OpenSpec-style
*delta + scenario* form (its economy + caveat-safety), and build with INFERNO's *parallel TDD
builders* (its speed). See OpenSpec lessons in §1, arm 6.

**Method.** Do **not** pick a shape by argument. Define the candidate doc shapes as **arms**, hold
the *builders* and *base commit* constant so only the docs vary, score every arm on one **0-10
rubric**, and read the **Pareto frontier** of quality-vs-doc-cost. Cheap measurements gate the
expensive builds (the funnel, §4).

**OpenSpec, in one paragraph (the borrowed discipline).** AI-DLC and INFERNO are both *feature-batch*
systems — everything is scoped to one feature and frozen. OpenSpec is a *capability-accumulation*
system: a durable per-capability `specs/` tree is the source of truth, and each feature is a **delta**
(`ADDED`/`MODIFIED`/`REMOVED` requirements) against it, with every requirement carrying ≥1
`GIVEN/WHEN/THEN` **scenario**, gated by `validate --strict`, then merged into the spec and
**archived**. Deltas can't drop a caveat by re-summarizing (they don't re-summarize); scenarios make
a caveat a first-class testable unit; archiving keeps the active surface small (~250 lines/change).
The one catch for us: OpenSpec is brownfield-*tolerant* but spec-cold-start-*naive* — on a 20-year
codebase with no specs you must author a one-time **baseline capability spec**, and that baseline is
exactly where AI-DLC's inception-decision quality has to re-enter. That seam *is* the turbo fusion.

---

## 1. The six arms (only the docs vary; builders + base are held constant)

| # | Arm | Artifact set | Key risk it carries | ~Planning lines |
|---|---|---|---|---|
| 1 | **AI-DLC** (control / status quo) | inception-log, requirements, system-context, impact-analysis, units.md, per-unit briefs + construction-logs, per-story files | restatement bloat; review burden | ~3,454 |
| 2 | **AI-DLC-light** | drop ceremony (briefs, system-context, logs); compress requirements+impact into one Decisions+Release-gates ledger; keep story files | does it keep AI-DLC's decision quality after the cut? | ~1,700 |
| 3 | **Turbo-A** (merge to one full unit) | trimmed requirements + decisions ledger + **one full-fidelity item per buildable thing** (AC+edges+notes+caveats, deps/ownership in frontmatter); story and work-item are the same file | none re-summarized; bet that one schema serves both inception + build | ~1,550 |
| 4 | **Turbo-B** (two layers, link) | story = source of truth (full); work-item = thin pointer (link + deps + ownership + verify-cmd), never copies | most traceable; more files; is the extra layer worth it? | ~1,900 |
| 5 | **INFERNO** (control / lean) | brief + lean work-items with `depends_on` / `ownership.editable` / `context.required` | lossy flattening (the OQ-012 class) | ~661 |
| 6 | **OpenSpec-style** | per-capability `spec.md` (durable) + a change folder (`proposal.md`, optional `design.md`, `tasks.md`, delta `specs/*` with ADDED/MODIFIED/REMOVED + GWT scenarios); `validate --strict` gate; archive-merge | brownfield cold-start: needs a one-time baseline capability spec | ~250 + one-time baseline (~40-80) |

Arms 1 and 5 are the **controls** (the two extremes we already have). Arms 2-4 are the slim variants
of the AI-DLC line. Arm 6 imports the OpenSpec discipline. The four design-space *corners* are
1 / 3 / 5 / 6 (heavy / fusion / lean / capability); 2 and 4 are intermediate points that tell us
*where on the curve the quality cliff is*, if there is one.

---

## 2. Metrics and the 0-10 rubric

Three families: a **judged quality** scorecard (the headline, decimals + weights), an **objective
doc-economy** scorecard (auto-measured), and **process metrics** (reported, not scored). The verdict
is the Pareto frontier of the first two, behind two hard gates.

### 2a. Quality scorecard — judged 0.0-10.0, weighted (sum of weights = 1.00)

Each dimension is scored to one decimal by each judge against the anchors below; the arm's quality
composite = Σ(weight × score), reported to two decimals. Anchors are given at 10 / 7.5 / 5 / 2.5 / 0;
interpolate for in-between.

| Dim | Wt | 10.0 | 7.5 | 5.0 | 2.5 | 0.0 |
|---|---|---|---|---|---|---|
| **Correctness** | 0.18 | compiles; every AC met; no logic defect; edge/resolution math correct | compiles; all ACs met; ≤1 minor non-load-bearing defect | compiles; one AC partially wrong OR a bug in a non-critical path | compiles but a **load-bearing** AC is wrong (e.g. einddatum-cap class) | won't compile / core feature broken at runtime (phantom NOT NULL column) |
| **Caveat / OQ handling** | 0.16 | every real/planted caveat preserved in the builder-facing doc **and** correctly handled in code | all caveats preserved; one handled conservatively but suboptimally | one caveat survives in docs but is mishandled in code | a load-bearing caveat dropped from builder-facing docs but caught by a link/secondary path | caveat dropped **and** acted on wrongly (phantom column reinvented) |
| **Spec fidelity** | 0.14 | full written scope delivered; no creep, no silent descope | full scope; one defensible interpretation flagged explicitly | a minor scope item dropped/added without flagging | ~half the scope reinterpreted/descoped without an explicit decision | builds something materially different from the spec |
| **Robustness / concurrency** | 0.12 | edge cases + concurrency (refresh-before-save, re-read-before-delete) handled throughout | edge cases handled; concurrency on the critical path only | happy path solid; some edge cases unhandled | happy-path only; a known race left open | fragile; fails on ordinary edge input |
| **Testability** | 0.12 | all load-bearing rules in DB-free unit tests, written test-first, meaningful assertions | most rules unit-tested DB-free; a few only in ITs | key rules tested but mostly via DB-bound ITs that can't run in CI | few tests; mostly smoke | no meaningful tests |
| **House-idiom fit** | 0.10 | zero idiom violations; ASCII-only code; strings in `.properties`; VP base-classes/patterns | ≤2 trivial lint issues | several drifts (some non-ASCII, some inline strings) | pervasive idiom violations | ignores house conventions entirely |
| **Maintainability** | 0.10 | DRY, self-explanatory, single-source-of-truth; cheap to change | clear; minor duplication | some duplication/ambiguity; still readable | notable duplication or confusing structure | copy-paste sprawl; unsafe to change |
| **Architecture** | 0.08 | clean layering; logic in testable seams; no cross-layer leakage | good layering; one minor smell | workable; some responsibilities misplaced | tangled (e.g. UI strings in persistence layer) | no coherent structure |

Quality composite ∈ [0, 10]. Reported per-judge and as the mean across the 3-judge panel, with
inter-judge spread (max−min) so we can see disputed scores.

### 2b. Doc-economy scorecard — objective, auto-measured, normalized 0-10 (10 = leanest in the set)

| Metric | Definition | Direction |
|---|---|---|
| **Files** | count of planning artifacts per feature | lower better |
| **Lines** | total planning lines per feature (baseline counted separately for arm 6) | lower better |
| **Gen-tokens** | output tokens spent producing the plan (from the agent run usage) | lower better |
| **Restatement ratio** `R` | total mentions of load-bearing facts ÷ distinct load-bearing facts (R≥1; 1 = each fact written once) | lower better |
| **Review-diff size** | lines a human must read to approve one change (full bundle for batch arms; delta-only for arm 6) | lower better |

Each metric `m` is normalized across the arms in the run: `score = 10 × (max − m) / (max − min)`
(so the leanest arm = 10, the heaviest = 0). Doc-economy composite = mean of the 5 normalized scores
(equal weight by default). Report **both** the raw vector and the composite — the raw numbers are what
we actually care about; the normalization is only to put it on the same axis as quality.

### 2c. Process metrics — reported, not in any composite

- **Wall-clock to first green build** (plan → all DB-free UTs green + full compile).
- **Parallelism width** = max concurrent builders the arm's ownership graph permits (the
  converter-granularity concern; see TP-4).
- **Build tokens** (output tokens for the build phase, separate from gen-tokens).

### 2d. The verdict — Pareto frontier behind two gates

**Hard gates** (fail → arm is ineligible regardless of scores):

1. **Build = green** (compiles under JDK8 offline; all DB-free UTs pass).
2. **Caveat-survival = 100%** — no load-bearing caveat (OQ-012 class) dropped from the
   builder-facing doc (measured by TP-3).

**Among eligible arms:** plot quality composite (y) against raw planning lines *and* gen-tokens (x);
find the Pareto frontier. **Primary pick = the frontier arm with the best quality-per-doc-line that
stays within a max quality regression ε of the AI-DLC control** (default ε = 0.5 on the 10-scale).
**Tie-breakers, in order:** caveat-survival margin → review-burden (TP-5) → wall-clock (TP-4).

**"Turbo confirmed"** iff a fusion arm (Turbo-A/B or OpenSpec) reaches quality ≥ (AI-DLC − ε) at
planning-lines ≤ 2× INFERNO. That is the precise statement of Ruben's hypothesis.

---

## 3. The seven test plans

Each plan isolates one question. "Cost" is rough relative effort (LOW = no build, MED = partial,
HIGH = full builds + judges). Plans are run as a funnel (§4), not all at once.

### TP-1 — Controlled head-to-head build *(HIGH)*
- **Question:** which doc shape yields the best code per doc-line, end to end?
- **Arms:** the survivors of the cheap filters (target 2-3), plus both controls.
- **Setup:** one frozen intent (BTW) at one base commit (bolt-002 `6e1259fb7cf`). Each arm's docs are
  produced, then handed to the **same canonical `specsmd-inferno-builder`** body (TDD gate on), same
  JDK8-offline-maven verification recipe (`install moca.database` first, then compile downstream; no
  Oracle → DB-free UTs run, ITs compiled-not-run). A **frozen normative AC checklist** is the contract
  every arm must satisfy, so fidelity measures doc-faithfulness, not divergent product decisions (this
  removes the scope-confound from the prior verdict, where AI-DLC silently descoped half the feature).
- **Metrics:** full quality scorecard (3-judge, anonymized arm labels) + doc-economy + process metrics.
- **Output:** the Pareto plot and the primary pick.

### TP-2 — Doc-economy micro-benchmark *(LOW, no build)*
- **Question:** how lean is each arm's planning output, and how much is restatement?
- **Arms:** all 6.
- **Setup:** generate **only** the planning docs for each arm, across 3-4 intents (BTW + others), no
  builders. Run `measure-docs` (§5) for files/lines/gen-tokens; run the restatement-ratio protocol.
- **Metrics:** doc-economy scorecard (raw + normalized), per intent and averaged.
- **Exit:** ranks arms by economy; cheap, repeatable, multi-intent → first funnel filter.

### TP-3 — Caveat-survival injection *(LOW-MED)*
- **Question:** does the slim form preserve load-bearing caveats, or silently drop them?
- **Arms:** all 6.
- **Setup:** maintain `caveats.yaml` — K known load-bearing caveats for the intent (the real OQ-012
  "no column exists", "sync-led / blokkering works forward-only", "ROUND_HALF_UP scale 2", "decade-sync
  stays", plus synthetic plants). For each arm, a checker reads the **builder-facing** artifact only
  (the doc a builder would actually act on) and marks each caveat present/absent/mangled. Optional
  MED add-on: dispatch one builder per arm on a caveat-sensitive item and check whether the bug class
  reappears (e.g. phantom column).
- **Metrics:** caveat-survival rate (this feeds the §2d hard gate).
- **Exit:** any arm <100% survival is flagged; either fixed (e.g. enforce link-don't-restate / scenario
  format) or gated out of TP-1.

### TP-4 — Parallelism / throughput *(MED)*
- **Question:** how wide does each arm actually fan out, and how fast does it reach green? (tests
  INFERNO's core advantage and the converter-granularity "chop" idea.)
- **Arms:** TP-1 survivors.
- **Setup:** from each arm's `ownership.editable` / dependency graph, compute the max non-overlapping
  concurrent builder set; then run the build measuring actual concurrency and wall-clock. Include a
  "chopped" variant of the winning arm (foundation item + disjoint-ownership leaves, per the converter
  note) to see if finer decomposition recovers width.
- **Metrics:** parallelism width; wall-clock to green; edit-collision / blocked rate (must stay ~0).
- **Exit:** quantifies the speed dimension the headline rubric does not capture.

### TP-5 — Review-burden study *(LOW, human-in-loop)*
- **Question:** which arm is actually cheapest for a human to review and trust? (the stated pain.)
- **Arms:** all 6 (or TP-2 survivors).
- **Setup:** Ruben (or a proxy judge) reviews each arm's planning output cold. Capture: time-to-first-
  approve, number of approval gates/checkpoints, number of distinct decisions surfaced for sign-off,
  and a subjective 0-10 "I trust this enough to build from it" score. For arm 6, review is the
  delta only.
- **Metrics:** review-minutes, #gates, #decisions, trust score.
- **Exit:** the human-cost axis the objective doc-economy can only proxy.

### TP-6 — Generalization *(HIGH)*
- **Question:** does the TP-1 pick hold on a different feature, or did we overfit to BTW?
- **Arms:** the TP-1 front-runners.
- **Setup:** repeat TP-1 on a 2nd (and ideally 3rd) intent — procesbeheer is the obvious second
  (artifacts already exist in its worktree). Same builders, same rubric.
- **Metrics:** full scorecards; check whether the ranking is stable.
- **Exit:** confirms or refutes the pick before we commit the flow change.

### TP-7 — Capability-accumulation *(MED, OpenSpec-specific)*
- **Question:** does the delta/capability model pay off over *time* — the property only arm 6 has?
- **Arms:** arm 6 vs the batch arms (1-5).
- **Setup:** run a **second** change against the same capability built in TP-1 (e.g. a follow-up VAT
  tweak). For arm 6 the second change is a small delta against the now-merged capability spec; for the
  batch arms it is a fresh full feature bundle.
- **Metrics:** spec-reuse ratio (reused vs re-authored lines on change #2); review-diff size on
  change #2; restatement ratio across the 2-change sequence.
- **Exit:** tests whether arm 6's one-time baseline cost amortizes into a long-run win.

---

## 4. The funnel (sequencing, gates, and the decision each stage unlocks)

```
Stage A  (cheap, all 6 arms)        TP-2 doc-economy  +  TP-3 caveat-survival  +  TP-5 review-burden
            |  gate: caveat-survival = 100% (TP-3);  keep top ~3 by economy+review (TP-2/5)
            v
Stage B  (expensive, survivors)     TP-1 head-to-head build  +  TP-4 parallelism
            |  gate: build green;  primary pick by Pareto rule (§2d)
            v
Stage C  (confirm the pick)         TP-6 generalization (2nd intent)  +  TP-7 capability-accumulation
            |  gate: ranking stable across intents
            v
         Decision: adopt the winning shape into the flow (or a flagged opt-in mode)
```

Rationale: never spend a full build on an arm that fails the cheap caveat gate or is obviously
review-heavy. Stage A is multi-intent and re-runnable for ~free; Stage B is the costly truth; Stage C
guards against a one-feature fluke.

---

## 5. Harness notes (how to automate the measurement)

- **`measure-docs`** (script): given an intent's artifact dir, emit JSON `{files, lines, by_type}`.
  Already prototyped ad-hoc with `find … -name '*.md' -exec wc -l`; promote to a checked-in script so
  every arm/intent is measured identically. Count arm-6 baseline in a separate field.
- **Gen-tokens / build-tokens:** read from the agent-run usage (`subagent_tokens` per dispatched
  builder/planner) or the model API logs; sum per phase. Record per arm.
- **Restatement ratio:** two-pass, semi-automated. (1) A "fact-extraction" agent reads the arm's docs
  and emits the list of distinct load-bearing facts (canonicalized). (2) For each fact, grep/semantic-
  match its mentions across all docs; `R = Σ mentions / |distinct facts|`. Keep the fact list per
  intent in `facts/<intent>.yaml` so it's stable across arms and re-runs.
- **Caveat-survival:** `caveats.yaml` lists each caveat with an id, a human statement, and a detector
  (regex + a semantic check prompt). A checker agent reads only the **builder-facing** artifact of each
  arm and marks present/absent/mangled. 100% present = pass the §2d gate.
- **Review-diff size:** for batch arms = total builder-facing lines; for arm 6 = the delta + proposal
  lines only (what a reviewer reads before approving). Capture from `measure-docs` with a `--review`
  mode that, for arm 6, counts `changes/<name>/**` and excludes the durable `specs/`.
- **Builder constancy (critical for validity):** every arm is built by the **same** canonical
  `specsmd-inferno-builder` body with the TDD gate on. If the live subagent *type* can't be registered
  mid-session (registry loads at startup), fall back to `general-purpose` with the full builder body
  inlined — identical to how the A2 rerun was run. Same base commit, same maven recipe.
- **Judge panel:** 3 independent judges, distinct lenses (correctness/robustness; idiom/architecture;
  testability/fidelity), **arm labels anonymized** (strip flow names from the trees before judging).
  Each scores all 8 dims 0-10 against the §2a anchors. Composite per §2d; report inter-judge spread.

---

## 6. Threats to validity and controls

- **Single-intent overfit** → TP-6 (≥2 intents) before any adoption decision.
- **Scope-interpretation confound** (the prior verdict was not apples-to-apples: AI-DLC silently
  descoped ~half the feature, so its "cleanliness" partly reflected building less) → the **frozen
  normative AC checklist** in TP-1: every arm must satisfy the same ACs, so fidelity measures
  doc-faithfulness, not divergent product calls.
- **Judge bias / non-blindness** → anonymize arm labels; report inter-judge variance; a dimension with
  high spread is re-adjudicated, not averaged silently.
- **Builder nondeterminism** → if budget allows, N=2-3 build seeds per arm in TP-1; report the spread,
  not a single point.
- **OpenSpec baseline amortization** → count the one-time baseline separately from per-feature
  doc-cost; the long-run payoff is measured explicitly in TP-7, not assumed in TP-1.
- **No-Oracle blind spot** → the einddatum-cap class of bug (correctness) can't be caught by DB-free
  UTs; either add a contract/DB-in-CI test for the resolution layer, or mark correctness scores on
  DB-dependent paths as "unverified" rather than "passed".

---

## 7. Open questions / parking lot

- **Dutch-heading extractor gap:** the inception-import extractor only matches `## Acceptance
  Criteria`, not `## Acceptatiecriteria` — fix before TP-2 or the Dutch intents under-extract ACs.
- **Idiom/lint `finalize_check`:** should an ASCII-only / no-hardcoded-strings gate be added to *all*
  arms equally (so it's not a differentiator), or measured as a quality differentiator? Default: add it
  to all arms; idiom drift is a builder property, not a doc-shape property.
- **The "chop" converter mode** (`inferno-converter-granularity-idea.md`) is the natural TP-4 variant;
  if Turbo-A wins TP-1, test whether chopping it recovers parallelism width without raising collisions.
- **Where does the turbo flow live** — a new `src/flows/` entry, a mode on AI-DLC, or a smarter
  converter on the AI-DLC→INFERNO bridge? Decide *after* TP-1/TP-6 name a winning shape; the eval is
  shape-first, packaging-second.
