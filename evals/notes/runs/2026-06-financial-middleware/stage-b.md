# Stage B — real builds (financial-middleware, intent 001, 3-unit gradient)

Cross-app leg (TP-6 third leg). Every arm built by the **same** canonical `specsmd-inferno-builder`
agent (real RED→GREEN TDD via `superpowers:test-driven-development`); the doc-shape is the only
variable. DB-free verify (`mvn -q -pl translation-layer -am test`, Oracle/ES/queue mocked), each in
an isolated worktree off the unit's frozen base + a hardlink-cloned private maven repo. Build-green
gate #1 = the exact verify command exits 0 with 0 failures / 0 errors.

Method/why: `../../../notes/doc-slimming-eval-framework.md`. Stage-A gate + economy: `stage-a.md`.

## Build matrix (16 builds: engine ×6, polling ×5, tracking ×5)

`inferno` (lean control) is built for **engine only** — it hard-failed the Stage-A caveat gate on all
units (0/6 polling, 3/11 tracking), so it is carried as a documented negative control on the single
unit where a build best exposes the hollowing (engine). The other 5 arms build all 3 units.

| arm | engine (base 08eabfd) | polling (base 66be5ca) | tracking (base 4b04785) |
|---|---|---|---|
| **aidlc** (heavy ctrl) | ✅ 88/0/0 | ✅ 21/0/0 | ✅ 159/0/0 |
| **aidlc-turbo** | ✅ 81/0/0 | ✅ 24/0/0 | ✅ 136/0/0 |
| **turbo-a** | ✅ 62/0/0 | ✅ 16/0/0 | ✅ 134/0/0 |
| **turbo-b** | ✅ 64/0/0 | ✅ 17/0/0 | ✅ 130/0/0 |
| **inferno-full** (honest-lean) | ✅ 58/0/0 | ✅ 15/0/0 | ✅ 138/0/0 |
| **inferno** (lean ctrl) | ⚠️ 45/0/0 **HOLLOW** | — (gate hard-fail) | — (gate hard-fail) |

`N/F/E` = Tests run / Failures / Errors (tracking totals = commons + translation-layer aggregate).
**All 16 builds GREEN.** The 3 tracking builds the API timeout interrupted were resumed from the same
agent's transcript and finished to GREEN; all 5 tracking builds were then **independently re-verified
clean-room by the orchestrator** (re-ran the exact verify command), EXIT=0 / 0F / 0E each — see
"API-timeout interruptions" below.

## ENGINE wave (HIGH complexity — transformer/, worker/, queue/, TranslationService)

All 6 compile + test green. **The decisive result is `inferno`:** it builds green at 45 tests but is
**hollow** — an opaque pass-through transformer with **no Visma field mappings** (`vatId`/`startDate`/
`vatRate`, the `100 - reverseVat` derived "niet" fields, HALF_UP rounding) and **none of the bolt-007
fixes** (semaphore-acquire-inside-vthread, `markAsProcessing` in the poll TX, null-`btwId` →
`TransformationException`, `LocalDate.MAX` sort fallback). Stage-A predicted exactly this (engine
caveat-survival 4/11): with the `../../aidlc` links excluded, the lean work-item carries goals but not
the construction-time mapping tables, so a green build is necessarily empty of the real behavior. The
5 gate-passing arms all carry the full mappings and wire `markAsProcessing`.

Builder-reported engine flavor (constant signal, not arm-biasing):
- **aidlc** 88/0/0 — full mappings, `markAsProcessing` wired into the poll TX.
- **aidlc-turbo** 81/0/0 — full mappings, wired.
- **turbo-a** 62/0/0 — full, wired; added empty-batch skip; derives priority from sourceData.
- **turbo-b** 64/0/0 — full mappings; `markAsProcessing` enum-only (left the status query to polling).
- **inferno-full** 58/0/0 — full mappings, wired.
- **inferno** 45/0/0 — **HOLLOW** (see above).

**Systematic gaps flagged by ALL 6 engine builders** (constant across arms → non-biasing; they reflect
the frozen base + reference silences, not the doc shape): the base `BerichtHandelingVpDto` has no
priority column → everything defaults to `NORMAL`; `notValidAfter` value unspecified; no
`visma-integration.md` in any arm → wire-alias names defaulted; status-tracking is unit-003,
out-of-scope here.

## POLLING wave (MED complexity — service/PollingService, repository, model)

All 5 compile + test green off the empty translation-layer scaffold (`66be5ca`). aidlc 21, aidlc-turbo
24, turbo-a 16, turbo-b 17, inferno-full 15. (Spec-was-wrong findings logged in Stage A: the heavy
doc's `ddd-02` carried an unparseable `SKIP_LOCKED` hint and conflated `fetchSize` with a row cap;
faithful arms corrected to a real bounded batch.)

## TRACKING wave (LOW code-complexity, HIGH caveat-density — Oracle+ES dual-write, actuator/health)

5 arms off `4b04785` (commons+polling+engine). Editable surface includes `commons/src/**` for the
shared `StatusTrackingService`/`StatusTrackingEvent`. This unit carries the densest caveat set
(best-effort NON-atomic dual-write, dedicated virtual-thread executor, `@PreDestroy`/`@DependsOn`
shutdown ordering, parallel health checks, DEGRADED registration, record null-validation).

**Clean GREEN (2):**
- **turbo-a 134/0/0** — full TDD build. Honored best-effort non-atomic dual-write (two independent
  `CompletableFuture`s, each own `.exceptionally`, neither propagates; both-directions tested),
  append-only write-entity (own sequence PK), correlationId propagation, dedicated
  `newVirtualThreadPerTaskExecutor`, `@PreDestroy`+`@DependsOn` ordering, parallel health checks,
  immutable `@ConfigurationProperties` record with `@Min(1)`, record null-validation, 4096 truncation.
  Gaps flagged (eval signal): DEGRADED `status.order`/`http-mapping` are documented in the **app-module**
  `application.yaml` (outside this unit's ownership) → implemented equivalently as in-module
  `StatusAggregator`+`HttpCodeStatusMapper` beans; spec-introduced `commons.MessageStatus` (lifecycle)
  vs `TranslationStatus` duplication kept because the spec names both; H2 `@Enumerated` CHECK on the
  shared `bh_status` column required a test-scoped schema (real Oracle has no such check).
- **turbo-b 130/0/0** — full TDD build, 39 new tracking tests, same caveat coverage; hit + fixed the
  same H2-CHECK trap via `@EntityScan` test-schema isolation; same app-yaml-vs-bean and messageId-vs-
  correlationId datamodel tensions flagged.

**Clean GREEN after resume (3):** aidlc 159/0/0, aidlc-turbo 136/0/0, inferno-full 138/0/0 — see below.

## API-timeout interruptions (eval integrity)

An API/stream timeout during the tracking wave cut three builders off **before final GREEN**. Because
their final summaries were lost (came-to-rest) or the stream stalled, the orchestrator re-verified each
worktree clean-room (re-ran the exact verify command) rather than trust the lost summary — this is what
surfaced the RED states. All three were interrupted-mid-TDD, **not** doc-shape signals (the required
fixes are exactly what the 2 clean finishers, turbo-a/turbo-b, already did). Each was resumed from the
**same agent's transcript** (preserving builder constancy + TDD context) with precise diagnostics;
hand-fixing was deliberately avoided so the doc-shape stays the only variable.

- **aidlc** — was 138/1f/3e → **159/0/0**. The 3 `MessageRepositoryTest` errors were a genuine
  **spec-was-wrong finding** (eval signal): the heavy doc mapped the append-only write-entity onto the
  *same* table as the `@Immutable` read entity, which is incompatible under shared auto-DDL (the
  write-entity's NOT-NULL leaked onto the pre-existing poll tests). The builder split it into a distinct
  `BAE_BERICHT_HANDELING_STATUS` table (real NOT-NULL FK kept, read schema untouched) and documented the
  deviation; the flaky `ParallelChecks` wall-clock assertion was made deterministic via a `CyclicBarrier`
  rendezvous (proves overlap by behavior, no wall-clock threshold).
- **aidlc-turbo** — was COMPILATION ERROR (test referenced unwritten `TranslationStatusTracker`) →
  **136/0/0**. Wrote the missing production class + full tracking stack; surfaced the same spec-was-wrong
  shared-table NOT-NULL regression (fixed by dropping the DDL constraint, nullability owned by the
  ViewPoint schema).
- **inferno-full** — was 138/0f/2e (Mockito `UnnecessaryStubbing` + `UnfinishedStubbing`, stalled at
  "about to confirm GREEN") → **138/0/0**. Hoisted the nested stubbed call out of the `when(...)` and
  added `verify(timeout(500))` so the both-throw stubs are deterministically exercised; strict stubbing
  kept, no assertions weakened.

**Closing re-verify sweep (orchestrator, clean-room):** all 5 tracking builds re-run from scratch with
the exact verify command — inferno-full run alone first (tightest wall-clock health assertion), then the
other four concurrently — **EXIT=0, 0F/0E every build.** Build-green gate #1 holds for the entire
timeout-affected wave under independent verification.

## Build-green gate (#1) — final

**All 16 builds PASS** (6 engine, 5 polling, 5 tracking; EXIT=0 / 0F / 0E). `inferno` engine passes
build-green but is the documented **hollow** negative control (compiles + 45 green tests, but an opaque
pass-through with no Visma mappings and none of the required corrections).

## Judge panel — 3 blind lenses × 3 units, 8-dim weighted 0–10 rubric

16 anonymized diffs (sanitized of provenance vocabulary, per-unit shuffle `E1–E6`/`P1–P5`/`T1–T5`,
map in `results/judge-shuffle-map.md`) scored blind. Composite = Σ(weight × score); weights Corr .18 ·
Cav .16 · Fid .14 · Rob .12 · Test .12 · Idiom .10 · Maint .10 · Arch .08. Per-unit composite = mean of
the 3 lens composites; per-arm overall = mean of its unit composites. Full numbers:
`results/judge-aggregate.txt`. **Inter-judge agreement was high** — every composite lens-spread ≤ 1.4
(vs run #2's 2.20) and **no lens inverted any ranking**, so no formal re-adjudication was triggered (the
widest spreads — P5 1.39, P3 1.21 in polling — are severity gradients on a defect all three lenses
flagged, not disputes; for P3's idiom dim the idiom-specialist lens correctly caught a `@Transactional`
self-invocation bug and is the authoritative read).

### Per-unit composites (de-anonymized)

| rank | ENGINE | | POLLING | | TRACKING | |
|---|---|---:|---|---:|---|---:|
| 1 | turbo-a | 8.97 | aidlc | 8.24 | aidlc-turbo | 9.29 |
| 2 | aidlc | 8.89 | turbo-a | 7.63 | turbo-a | 9.16 |
| 3 | aidlc-turbo | 8.78 | aidlc-turbo | 7.18 | turbo-b | 8.57 |
| 4 | inferno-full | 7.93 | inferno-full | 6.91 | aidlc | 8.17 |
| 5 | turbo-b | 7.64 | turbo-b | **4.77** | inferno-full | 6.87 |
| 6 | **inferno 3.07** | | — | | — | |

### Per-arm overall build quality

| arm | engine | polling | tracking | **overall** | gate |
|---|---:|---:|---:|---:|:---:|
| **turbo-a** | 8.97 | 7.63 | 9.16 | **8.58** | PASS |
| **aidlc** (heavy ctrl) | 8.89 | 8.24 | 8.17 | **8.43** | PASS |
| **aidlc-turbo** | 8.78 | 7.18 | 9.29 | **8.42** | PASS |
| inferno-full (honest-lean) | 7.93 | 6.91 | 6.87 | **7.24** | FAIL |
| turbo-b | 7.64 | 4.77 | 8.57 | **7.00** | PASS |
| inferno (lean ctrl) | 3.07 | — | — | **3.07** | FAIL |

## Headline findings

### 1. The hollow lean control (inferno) is catastrophic on quality — and gate-failed first.
inferno's engine build is green (45 tests) but an **opaque pass-through**: panel means Correctness
**2.0**, Caveat **1.2**, Fidelity **1.5** — the transformers wrap raw `sourceData` under a `"VISMA"`
tag with zero field mapping (no `vatId`/`vatRate`, no derived `nonReclaimableVat/nonDeductibleVat`, no
rounding, no null-`btwId` guard), the strategy is an interface not the required abstract class, and its
tests assert only `body().isNotBlank()` so they could never go RED. This is the doc-slimming risk made
concrete on a **third app/stack**: caveat-loss in the plan → a green-but-empty build. The cheap Stage-A
gate (13/36 facts, hard-fail) called it before a line was built.

### 2. The heavy AI-DLC control is Pareto-dominated — for the third time.
turbo-a (overall **8.58**, doc-economy **9.3**) beats the heavy aidlc control (**8.43**, economy
**0.0**) on **both** axes while shipping **91% fewer doc lines** (616 vs 7046). aidlc-turbo (8.42 @ 8.3
economy) matches the heavy control's quality at 81% fewer lines. The doc bloat bought neither
correctness nor fidelity. Notably the heavy control's own builds slipped where the slim arms held: on
**tracking** aidlc (8.17) dropped the DEGRADED-registration and record-null-validation/`@Min(1)`
corrections that aidlc-turbo (9.29) and turbo-a (9.16) both built.

### 3. turbo-a is the cross-app frontier pick — best economy AND best quality.
Among the four gate-passers, **turbo-a Pareto-dominates all three others** (≥ on both economy and
quality vs aidlc, aidlc-turbo, and turbo-b). This reproduces the **BTW** result (run #1, turbo-a top at
8.65), not the procesbeheer result (run #2, turbo-a 3rd) — the cross-app leg sides with BTW. The top
three (turbo-a 8.58, aidlc 8.43, aidlc-turbo 8.42) are within 0.16 — a near three-way tie on quality,
with turbo-a winning the economy axis decisively.

### 4. The honest-lean control is hostage to its link set (gate-fail → real build gaps).
inferno-full (overall 7.24, gate-FAIL) builds measurably worse than every gate-passing slim arm. Its
**tracking** (6.87) omits DEGRADED registration and the per-type actuator counts, and its **engine**
(7.93) drops the `btw_geblokkeerd_yn → notValidAfter` mapping — exactly the construction-time caveats
its work-items' `context.required` did not link. Confirms Stage A: link the inception stories and you
lose the fix-layer detail; the build then loses it too.

### 5. The discriminating unit is where the business logic is hardest.
Engine (HIGH) and tracking (caveat-dense) spread the arms widely (3.07→8.97; 6.87→9.29); the per-arm
order is stable there. Polling (MED) is noisier and is where the two real per-build slips landed:
**turbo-b polling (4.77)** writes `bh_status='PROCESSING'` **back to the read-only ViewPoint source**
(a forbidden source mutation) with a non-functional repository — a genuine defect, gate-passed but
build-slipped (mirrors run #2's turbo-b weak bolt). aidlc-turbo (7.18) and inferno-full (6.91) both
built the bounded-batch cap as a non-capping `fetchSize` hint (the plant `synth-poll-batch-cap` itself
conflates the two — a known seeding artifact); aidlc and turbo-a implemented a real row cap.

## Pareto verdict

Among arms passing both hard gates (build-green + caveat-survival 100%): **aidlc, aidlc-turbo, turbo-a,
turbo-b**. inferno-full and inferno are gate-ineligible (carried as the honest-lean and lean controls);
openspec was carried in Stage A only (near-miss).

| arm | doc economy (Stage A 0–10) | build quality (Stage B) | gate | frontier? |
|---|---:|---:|---|---|
| **turbo-a** | **9.3** | **8.58** | PASS | ★ frontier — **dominates the field on both axes** |
| aidlc-turbo | 8.3 | 8.42 | PASS | dominated by turbo-a (ties heavy on quality at −81% docs) |
| aidlc (heavy) | 0.0 | 8.43 | PASS | **Pareto-dominated by turbo-a** |
| turbo-b | 8.8 | 7.00 | PASS | dominated (polling source-mutation defect) |
| inferno-full (honest-lean) | 7.8 | 7.24 | **FAIL** | ineligible |
| inferno (lean) | 10.0 | 3.07 | **FAIL** | ineligible — hollow build |

**Frontier = {turbo-a}.** The single leanest *complete* arm is also the highest-quality build — a
sharper result than either ViewPoint run. Every gate-eligible slim arm stays within ε = 0.5 of the
heavy control's quality (8.43 − 0.5 = 7.93): turbo-a 8.58 and aidlc-turbo 8.42 clear it comfortably;
turbo-b 7.00 is the one that does not, dragged solely by its polling source-mutation defect.

- **Best built code AND lowest review burden → turbo-a (recommended pick for this app class).** Leanest
  complete arm (616 lines, −91%) and top build quality (8.58), strongest on the two hard units
  (engine 8.97, tracking 9.16). Its one soft spot — a `@Transactional`-on-self-invocation seam in
  polling — is a fixable idiom-gate item, not a doc-shape limit.
- **Safest cross-intent all-rounder → aidlc-turbo.** Ties the heavy control on quality at 81% fewer
  docs and was the most complete tracking build (9.29); the robust #2 across all three runs.

## Thesis read-out — cross-app leg confirms, most sharply yet

The financial-middleware leg (Java/Spring, different stack, different team, different domain than
ViewPoint) **reproduces and sharpens** the load-bearing conclusion: you can cut **~80–91% of the
planning docs and not lose build quality**. The heavy AI-DLC control is Pareto-dominated (3rd run
running); the lean pointer-only control is the worst build *and* gate-fails on the exact caveats it
dropped (3rd run running). Three runs now agree:

| | BTW (run #1) | procesbeheer+koppellaag (run #2) | financial-middleware (run #3) |
|---|---|---|---|
| lean control (inferno) | last, 6.74, gate-FAIL | last, 6.96, gate-FAIL | **last, 3.07, gate-FAIL (hollow)** |
| heavy control (aidlc) | gate-fail/descoped | 7.67, Pareto-dominated | 8.43, **Pareto-dominated** |
| frontier | turbo-a (8.65) | {aidlc-turbo, turbo-a} | **{turbo-a}** |
| slim vs heavy | all 3 beat both controls | aidlc-turbo beats heavy; turbo-a/b within ε | turbo-a dominates; aidlc-turbo ties at −81% |

The cross-app variable did not break the ranking: the win is **structural** — write each load-bearing
fact once in the builder-facing doc and link rather than restate (heavy) or defer behind an unresolved
hop (lean). turbo-a leads here (as on BTW) rather than aidlc-turbo (as on procesbeheer); the two slim
shapes trade the top spot by app, but **a slim shape wins every time and the heavy control never does.**

