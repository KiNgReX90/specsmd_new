# Stage A — doc economy + caveat-survival gate (financial-middleware, intent 001)

Cross-app leg (TP-6 third leg). Method/why: `../../../notes/doc-slimming-eval-framework.md`;
how-to: `../../../notes/doc-slimming-replay-playbook.md`. Held constant from runs 1+2: the 7 arm
shapes, the harness scripts, the rubric+weights, the funnel + 2 hard gates, the canonical builder,
the blind 3-judge protocol. Only app+intent changed.

## A1 — Doc economy (whole-arm, all 3 units of intent 001)

`harness/measure-docs.sh` (objective):

| arm | files | lines | bytes | ~tokens | econ 0–10¹ |
|---|---:|---:|---:|---:|---:|
| aidlc (heavy ctrl) | 60 | 7046 | 310430 | 77607 | 0.0 |
| inferno-full (honest-lean ctrl) | 26 | 1700 | 92392 | 23098 | 7.8 |
| aidlc-turbo | 24 | 1340 | 82984 | 20746 | 8.3 |
| openspec (total) | 9 | 1289 | 73437 | 18359 | 8.4 |
| openspec (change-only)² | 6 | 784 | — | — | 9.1 |
| turbo-b | 18 | 983 | 73059 | 18264 | 8.8 |
| turbo-a | 6 | 616 | 67978 | 16994 | 9.3 |
| inferno (lean ctrl) | 4 | 159 | 12711 | 3177 | 10.0 |

¹ 10 = leanest in set (inferno), 0 = heaviest (aidlc); linear on lines.
² openspec's durable baseline (505 lines) amortizes across future changes; per-change economy counts only the change folder.

**Restatement (TP-2, vs 36 load-bearing facts)** — `excess` = redundant restatements beyond one-each:

| arm | facts present | mentions | excess | R (files/fact) |
|---|---:|---:|---:|---:|
| aidlc | 36/36 | 509 | **473** | 14.14 |
| inferno-full | 34/36 | 175 | 141 | 4.86 |
| openspec | 34/36 | 171 | 137 | 4.75 |
| aidlc-turbo | 36/36 | 160 | 124 | 4.44 |
| turbo-b | 32/36 | 147 | 115 | 4.08 |
| turbo-a | 34/36 | 113 | **79** | 3.14 |
| inferno | 13/36 | 24 | 11 | 0.67 |

The heavy control restates each load-bearing fact across **~14 files** (excess 473). Every slim
reshape collapses that to write-once-ish (excess 79–141) while still *carrying* the facts
(present 32–36/36). inferno's low excess (11) is not virtue — it simply omits 23/36 facts
(present 13/36), deferring them behind unresolved links.

## A2 — Caveat-survival gate (TP-3, hard gate)

Builder-facing doc only (for `inferno`, the work-item *without* following its `../../aidlc`
`context.required` links — that is the whole point of the lean control). ✓ present / ~ mangled-lossy
/ ✗ absent. Three checker agents, one per unit. Caveats = 25 real traps + 3 synthetic plants
(1/unit, marked Ⓢ).

### Per-unit scores (✓ only; ~ and ✗ both fail the 100% gate)

| arm | polling /6 | engine /11 | tracking /11 | gate |
|---|---:|---:|---:|:---:|
| **aidlc** (heavy ctrl) | 6 | 11 | 11 | ✅ PASS all units |
| **aidlc-turbo** | 6 | 11 | 11 | ✅ PASS all units |
| **turbo-a** | 6 | 11 | 11 | ✅ PASS all units |
| **turbo-b** | 6 | 11 | 11 | ✅ PASS all units |
| **openspec** | 5 | 10 | 10 | ❌ near-miss (only the 3 synthetic plants dropped) |
| **inferno-full** (honest-lean) | 4 | 11 | 9 | ❌ fail polling+tracking; pass engine |
| **inferno** (lean) | 0 | 4 | 3 | ❌ hard fail all units |

### What each non-passing arm dropped

- **openspec** — dropped **exactly the 3 synthetic plants** and nothing else: `synth-poll-batch-cap`
  (the "at most 500 / fetchSize" rule), `synth-visma-rate-rounding` (HALF_UP/2-decimals), and
  `synth-es-ttl-retention` (ttlDays=90/ILM). All 25 *real* caveats survived. Its capability-scenario
  normalization silently sheds specific load-bearing numbers — the plants are doing exactly the job
  they were planted for (they caught a fidelity tendency the real caveats happened to dodge). This
  mirrors run #2 (openspec near-miss 92%, carried in Stage A only).
- **inferno-full** — fails polling (`poll-skip-locked-overlap` survives only as a soft "consider … if
  applicable" suggestion; `poll-no-raw-payload-logging` absent) and tracking
  (`degraded-status-must-be-registered` absent; `correlationid-propagated-unchanged` lossy). Root
  cause: those rules live in the reference's **`ddd-02` technical-design / decisions layer**, which
  the work-items' `context.required` resolved *stories* do not include. The honest-lean control is
  only as faithful as the artifacts it links — link the inception stories and you lose the
  construction-time caveats. (It passes engine 11/11 because the engine work-item's context.required
  *did* include the fix-bolt ADR/ddd files.)
- **inferno** — the lean control behaving exactly as in runs #1/#2: with `../../aidlc` links excluded,
  only goals/summaries survive. The robust caveats (ADR-supersede, semaphore-bounded, abstract-class,
  queue-stub) degrade to lossy mentions; the implementation-specific fix-bolt caveats vanish.

### The robust vs fragile caveats (cross-cutting)

Survive in all 7 arms (most slimming-robust): the **ADR-001→002 async-dispatch supersede**,
**semaphore-bounded concurrency**, **TransformerStrategy abstract-class**, **queue placeholder stub**,
**best-effort/append-only dual-write**. Fragile under aggressive slimming (the fix-bolt
implementation details): semaphore-acquire-inside-vthread, markAsProcessing, null-btwId,
LocalDate.MAX sort fallback, DEGRADED registration, parallel health checks, record null-validation —
all originated in construction-time `ddd-02`/fix-bolt docs, so any shape that drops that layer loses
them.

## A3 — Gate verdict + Stage-B carry

**Arms passing the hard gate (caveat-survival 100% on all 3 units):** aidlc, aidlc-turbo, turbo-a,
turbo-b.

Consistent with both prior runs, **every slim reshape that keeps a write-once home for the
technical-design layer (aidlc-turbo, turbo-a, turbo-b) passes the gate at a fraction of the doc
volume** (excess 79–124 vs aidlc's 473; 616–1340 lines vs 7046). The two pointer/normalizing shapes
behave as before: inferno hard-fails, openspec near-misses on specifics, inferno-full is hostage to
its link set.

### Known artifacts (for the record)
- Plant `synth-poll-batch-cap` slightly contradicts the reference's own `bolts/001/ddd-02` prose
  ("no artificial limit / returns all PENDING"). The story AC is explicit, so faithful arms carry the
  plant cleanly; the contradiction is a seeding artifact, not an arm defect.
- inferno/inferno-full `context.required` for polling listed only the inception stories (polling has
  no fix-bolt), so its honest-lean control is weaker on polling than on engine by construction —
  noted, not corrected, as it faithfully reflects the lean shape's dependence on link choice.

→ Stage-B build set in `stage-b.md`.
