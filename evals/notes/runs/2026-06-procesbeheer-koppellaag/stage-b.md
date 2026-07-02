# Stage B results — build head-to-head + blind judge panel

**Date:** 2026-06-26
**Scope:** procesbeheer + koppellaag, the full 7-bolt program. Five arms built the two buildable
stacks — **procesbeheer 002 (service) + 003 + 004 (UI)** off base `2768f4fcd65`, and
**koppellaag 007 (UI)** off base `2d1310e9208` — by the **same** canonical TDD-gated
`specsmd-inferno-builder`. Only the planning docs varied. This is the **TP-6 full-intent
generalization check**: does the BTW ranking hold on a bigger, broader intent (2 intents, 7 bolts,
19 stories), or did we overfit?

Run in parallel (4-wide), each build in a hardlink-cloned isolated maven repo (`-Dmaven.repo.local`)
to kill the shared-`~/.m2` race without changing build semantics — see `build-recipe.md`. The diffs
were anonymized + shuffled (`P1–P5` pb, `K1–K5` kl, stack-distinct maps; two identity-leaking Javadoc
references sanitized) and scored blind.

## Builds — 10/10 green, TDD proven from transcripts

| arm | pb compile | pb new DB-free UT (RED→GREEN) | kl compile | kl new DB-free UT (RED→GREEN) |
|---|---|---:|---|---:|
| aidlc-turbo | EXIT 0 | 20 (13+7) | EXIT 0 | 9 |
| turbo-a | EXIT 0 | 24 (20+4) | EXIT 0 | 13 |
| turbo-b | EXIT 0 | 18 (13+5) | EXIT 0 | 13 |
| aidlc (heavy ctrl) | EXIT 0 | 19 (12+7) | EXIT 0 | 8 |
| inferno (lean ctrl) | EXIT 0 | 25 (10+6+9) | EXIT 0 | 9 |

All builds purely additive (0 deletions vs base → no regression by construction); ownership respected
(one logged spill: turbo-b put `ProcesSoort` in `moca.database`). Verification integrity: every arm's
new tests use `*Test`/`*UnitTest` (run under surefire); the project does NOT run `*UT` — aidlc-kl caught
this and renamed. Cross-arm constants (true for all, not defects): the doc-named `fin_vp_inrichter`
right does not exist in code (real: `fin_user_inrichter_read/edit`); DB-menu seeding is out of DB-free
reach.

## Judge panel — 3 blind lenses × 2 stacks, 8-dim weighted 0–10 rubric

Composite = Σ(weight × score); weights Corr .18 · Cav .16 · Fid .14 · Rob .12 · Test .12 · Idiom .10 ·
Maint .10 · Arch .08. Per-stack composite = mean of the 3 lens composites; overall = mean of the two
stacks (each build weighted equally). De-anonymized after scoring.

| arm | pb (mean / spread) | kl (mean / spread) | **overall** |
|---|---:|---:|---:|
| **aidlc-turbo** | 8.01 / 0.83 | 8.12 / 0.35 | **8.06** |
| aidlc (heavy ctrl) | 7.40 / 0.30 | 7.94 / 0.50 | **7.67** |
| **turbo-a** | 7.87 / 1.14 | 7.32 / 0.91 | **7.60** |
| turbo-b | 6.70 / 1.25 | 7.94 / 0.52 | **7.32** |
| inferno (lean ctrl) | 6.59 / 2.20 | 7.32 / 0.80 | **6.96** |

Per-dimension panel mean (avg of 6 reads/arm):

| arm | Corr | Cav | Fid | Rob | Test | Idiom | Maint | Arch |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| aidlc-turbo | 8.00 | 8.25 | 8.27 | 8.02 | 7.80 | 7.63 | 8.20 | 8.32 |
| aidlc | 7.52 | 7.63 | 7.88 | 6.92 | 8.05 | 7.30 | 8.13 | 8.20 |
| turbo-a | 7.42 | 7.95 | 7.90 | 7.17 | 8.17 | 6.93 | 7.43 | 7.55 |
| turbo-b | 7.07 | 7.45 | 7.55 | 6.55 | 8.08 | 6.93 | 7.72 | 7.23 |
| inferno | **6.23** | **6.23** | **6.77** | **6.13** | 7.97 | 7.52 | 7.97 | 8.12 |

## Headline findings

### 1. The lean control (inferno) is last on quality AND gate-fails — exactly as Stage A predicted.
inferno scores lowest on Correctness (6.23), Caveat-handling (6.23), Fidelity (6.77) and Robustness
(6.13) — the four dimensions where the dropped caveats live. Its **pb build (6.59)** is where the
damage concentrates: building bolt-002 from the lean work-item (caveats deferred behind unresolved
`context.required` links), it shipped **real defects the caveat-carrying arms avoided**:
- mapped proces-soort off **`BPS_INDELING_SOORT`** (the column the `prolongatieperiode-stays-not-null`
  caveat says is being *retired*) instead of `BPS_PROCES_TYPE` — the wrong discriminator;
- a list filter querying the **wrong column** (`PROCESS_TYPE = "EFA"` instead of `BPS_EXTERNE_FA`);
- the FK-RESTRICT "in gebruik" delete guard modeled as a **hardcoded table list** that is **never
  wired into the actual delete path** (so no runtime block).

This is the doc-slimming thesis's risk made concrete: caveat-loss in the plan → load-bearing build
defects. The cheap Stage-A gate (40% survival) called it before a line was built.

### 2. aidlc-turbo Pareto-DOMINATES the heavy AI-DLC control — on both axes.
aidlc-turbo (8.06) beats the heavy aidlc control (7.67) on build quality **while shipping 73% fewer
doc lines** (1282 vs 4789). The doc bloat bought neither correctness nor fidelity; the disciplined
decision-ledger + trimmed-stories shape built *better* code with far less to review. This is the
cleanest possible confirmation of the hypothesis.

### 3. The service bolt discriminates; the UI bolt does not.
Doc shape matters most where there is real business logic to get right. On the service-heavy **pb**
stack the arms spread **6.59 → 8.01**; on the delegation-heavy **kl** stack (a thin UI over an
existing business-API) they cluster **7.32 → 8.12**. The lean doc's caveat-loss bites hardest exactly
where the build is hardest — and is nearly invisible where the UI just delegates. (Highest inter-judge
spread is also on pb: inferno-pb 2.20, the `BPS_INDELING_SOORT` dispute — see below.)

### 4. The "best slim shape" is intent-dependent; aidlc-turbo is the robust cross-intent pick.
Unlike BTW (where turbo-a led at 8.65), here turbo-a comes in 3rd (7.60), dragged by its **kl build**
(7.32): a hand-rolled HTML encoder that **double-encodes** against DomUI's own escaping, plus a raw
`Table`/`TR` build that's less idiomatic. turbo-b's **pb build** (6.70) was its weak point: an
`allowedPhaseTransitions` that only ever returns the current phase (no real transition) and a
new-status dropdown whose value is never persisted. aidlc-turbo is the only arm strong on *both*
stacks (8.01 / 8.12) — and was the #2 all-rounder on BTW too.

## Re-adjudicated dispute (per protocol, not silently averaged)
**inferno-pb Correctness** drew the widest split: the two correctness-focused lenses scored it **3.2**
and **4.8** (load-bearing wrong-column defects), the idiom/architecture lens **7.8** ("a flagged,
internally-consistent interpretation"). Re-adjudication: the caveats explicitly name `BPS_PROCES_TYPE`
as the soort discriminator and flag `BPS_INDELING_SOORT` as retiring; two independent correctness
reads plus the caveat evidence carry it. The low scores stand — the lean control's correctness is
genuinely impaired, and the spread itself is the signal that the lean doc produced an ambiguous call.

## The Pareto verdict

Among arms passing both hard gates (build green + caveat-survival 100%): **aidlc, aidlc-turbo,
turbo-a, turbo-b**. inferno is gate-ineligible (40% survival) and carried only as the lean control.

| arm | doc economy (Stage A, 0–10) | build quality (Stage B) | gate | frontier? |
|---|---:|---:|---|---|
| **turbo-a** | **8.72** | 7.60 | PASS | ★ frontier — best economy |
| **aidlc-turbo** | 6.98 | **8.06** | PASS | ★ frontier — best quality |
| turbo-b | 6.90 | 7.32 | PASS | dominated by aidlc-turbo |
| aidlc (heavy) | 0.00 | 7.67 | PASS | **dominated by aidlc-turbo** |
| inferno (lean) | 10.0 | 6.96 | **FAIL** | ineligible |

**Frontier = {aidlc-turbo, turbo-a}.** aidlc-turbo dominates both the heavy control and turbo-b
(≥ on both axes). turbo-a sits on the frontier only because its doc economy (8.72) exceeds
aidlc-turbo's (6.98) at a modest quality cost. Every gate-eligible slim arm stays within ε = 0.5 of
the heavy control's quality (7.67 − 0.5 = 7.17): aidlc-turbo 8.06, turbo-a 7.60, turbo-b 7.32 — all
clear it while cutting docs 73–83%.

- **Best built code / best balance → aidlc-turbo (recommended default).** Highest quality (8.06),
  strong on both stacks, dominates the heavy control on both axes, lowest-friction migration from
  today's AI-DLC (drop ceremony, keep trimmed stories + a decisions ledger).
- **Lowest review burden → turbo-a.** Leanest *complete* arm (835 lines, −83%), within ε of the heavy
  control on quality; pick it when review cost is the binding constraint and you accept a slightly
  thinner build (its kl double-encoding slip is a fixable lint/idiom gate, not a doc-shape limit).

## Thesis read-out — confirmed, with a sharper edge than BTW

You can cut **~70–83% of the planning docs and not lose build quality** — on this deeper, broader,
2-intent program the result **generalizes**: the heavy AI-DLC control is **Pareto-dominated** by a
73%-slimmer arm (aidlc-turbo) that also builds better, and the lean pointer-only control is the worst
build *and* gate-fails on the exact caveats it dropped. The two ViewPoint runs now agree on the load-
bearing conclusions:

| | BTW (units 002/003) | procesbeheer+koppellaag (7 bolts) |
|---|---|---|
| lean control (inferno) | last, 6.74, gate-FAIL | last, 6.96, gate-FAIL |
| aidlc-turbo | 8.55 (2nd, best balance) | **8.06 (1st, dominates heavy)** |
| heavy control (aidlc) | gate-fail/descoped | 7.67, **Pareto-dominated** |
| slim shapes vs heavy | all 3 beat both controls | aidlc-turbo beats heavy; turbo-a/turbo-b within ε |

The one thing that did **not** replicate: turbo-a was BTW's top build (8.65) but only 3rd here (7.60),
because its fused single-item shape is more sensitive to per-bolt builder slips (the kl double-encode).
That makes **aidlc-turbo the safer cross-intent default**, with turbo-a the choice when review economy
dominates. The win remains structural — write each load-bearing fact once, in the builder-facing doc,
and link rather than restate or defer behind an unresolved hop.

**Recommended next step:** adopt **aidlc-turbo** as the default slim shape; fold an idiom/lint gate
(ASCII-only source, strings in `.properties`, no double-encoding, no cross-layer enum placement) and a
caveat-inline check into the flow so no arm regresses what this panel flagged. Then run TP-6's third
leg — the financial-middleware cross-app check (see `todo.md`) — before committing the shape into the flow.
