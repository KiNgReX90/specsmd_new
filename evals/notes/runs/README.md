# Doc-slimming eval — cross-run ledger

One row per run of the doc-slimming eval. Each run lives in its own dated folder here and is
**self-contained** (stage-a + stage-b + a frozen `overview.html` artifact). This file is the place to
**compare all runs together** as they accumulate — the question is never one run's score, it's whether
the *ranking holds across intents and across apps*.

- **Why** (method, rubric, gates): [`../doc-slimming-eval-framework.md`](../doc-slimming-eval-framework.md)
- **How** (step-by-step, to run the next one): [`../doc-slimming-replay-playbook.md`](../doc-slimming-replay-playbook.md)
- **Cross-run artifact** (visual synthesis of all runs): [`cross-run-overview.html`](cross-run-overview.html) — open in a browser, or re-publish as a Claude artifact. The Pareto scatter shows the three archetype bands (heavy control on the zero-economy wall, lean control on the max-economy wall, slim winners up top) across all three runs.

Held constant across **every** run (or it's a new experiment, not a comparable run): the arm doc-shapes,
the harness scripts, the weighted 8-dim 0–10 rubric + weights, the Stage A→B funnel + 2 hard gates
(build green · caveat-survival 100%), the single canonical TDD-gated `specsmd-inferno-builder` for all
arms, and the blind 3-lens judge protocol. Only the **documentation shape** varies within a run; only
the **intent/app** varies between runs.

## Runs

| # | run | app | scope | date | status | folder |
|---|---|---|---|---|---|---|
| 1 | BTW units 002/003 | ViewPoint | 1 intent, 2-unit slice (~10 items) | 2026-06 | ✅ done | [`2026-06-btw-units-002-003/`](2026-06-btw-units-002-003/) |
| 2 | procesbeheer + koppellaag | ViewPoint | 2 intents, 7 bolts, 19 stories | 2026-06 | ✅ done | [`2026-06-procesbeheer-koppellaag/`](2026-06-procesbeheer-koppellaag/) |
| 3 | financial-middleware · message-translation | fin-middleware | 1 intent, 3-unit gradient (16 builds) | 2026-06 | ✅ done | [`2026-06-financial-middleware/`](2026-06-financial-middleware/) |

Run 3 is the **cross-app generalization leg** (TP-6 third leg) — does the ranking survive leaving
ViewPoint? **Result: yes (confirmed).** The originally-planned 4-intent fan-out (runs 3–6) collapsed to
**one run / 3 units**: only intent `001-message-translation` was fully constructed in the app (intent
002's bolts are `bolt.md`-only), so it was the only comparable, reproducible material. Its three units
(polling MED · engine HIGH · tracking caveat-dense) supply the complexity gradient a single intent
needs. Further fin-middleware intents remain optional future work if a second cross-app point is wanted.
See [`../../doc-slimming/todo.md`](../../doc-slimming/todo.md).

## Headline per run (compare the *shape*, not raw line counts)

Build quality = blind 3-lens weighted 0–10 panel. Doc economy = Stage-A 0–10 (10 = leanest).
"gate" = build-green + caveat-survival 100%.

### Run 1 — BTW units 002/003 (single intent, slice)

| arm | doc economy | build quality | gate | note |
|---|---:|---:|---|---|
| turbo-a | 8.09 | **8.65** | PASS | best code |
| aidlc-turbo ⭐ | 8.80 | 8.55 | PASS | best balance (recommended) |
| openspec | **9.27** | 7.93 | PASS | lowest review burden |
| INFERNO (lean ctrl) | 3.53 | 6.74 | **FAIL** | caveat C-9 dropped |
| AI-DLC (heavy ctrl) | 0.00 | (descoped) | **FAIL** | C-1, C-9 |

All three slim reshapes beat both controls; the win is structural, not volume.

### Run 2 — procesbeheer + koppellaag (2 intents, 7 bolts)

| arm | doc economy | build quality | gate | note |
|---|---:|---:|---|---|
| aidlc-turbo ⭐ | 6.98 | **8.06** | PASS | best quality — **Pareto-dominates heavy** (−73% docs) |
| turbo-a | 8.72 | 7.60 | PASS | best economy (−83% docs), within ε |
| turbo-b | 6.90 | 7.32 | PASS | dominated by aidlc-turbo |
| AI-DLC (heavy ctrl) | 0.00 | 7.67 | PASS | **Pareto-dominated** |
| INFERNO (lean ctrl) | 10.0 | 6.96 | **FAIL** | wrong soort/list col, unwired delete guard |

(openspec carried in Stage A only — near-miss 92% caveat survival, not built.)

### Run 3 — financial-middleware · message-translation (cross-app, 3-unit gradient)

| arm | doc economy | build quality | gate | note |
|---|---:|---:|---|---|
| turbo-a ⭐ | **9.3** | **8.58** | PASS | **dominates the field on both axes** (−91% docs) |
| AI-DLC (heavy ctrl) | 0.00 | 8.43 | PASS | **Pareto-dominated** (3rd run running) |
| aidlc-turbo | 8.3 | 8.42 | PASS | ties heavy on quality at −81% docs; robust #2 |
| inferno-full (honest-lean) | 7.8 | 7.24 | **FAIL** | link-set gaps: dropped DEGRADED reg + notValidAfter |
| turbo-b | 8.8 | 7.00 | PASS | polling source-mutation defect (gate-pass, build-slip) |
| INFERNO (lean ctrl) | 10.0 | **3.07** | **FAIL** | **hollow** engine: Corr 2.0 / Cav 1.2 / Fid 1.5 |

Different app + stack (Java 21 / Spring Boot / Maven / Oracle+ES) than ViewPoint. **The ranking held.**

## What's stable across runs (the cross-run read — 3 runs, 2 apps)

- **Lean pointer-only control loses and gate-fails — all three runs.** Dropping caveats behind
  unresolved links produces real, load-bearing build defects; on fin-middleware it produced an outright
  **hollow** build (green tests, zero field mappings, 3.07). The cheap build-less Stage-A gate predicted
  it every time before a line was built.
- **Slim ≠ worse — confirmed cross-app.** A 73–91%-slimmer doc shape matches or beats the heavy AI-DLC
  control on build quality. The heavy control is now **Pareto-dominated in both run 2 and run 3**; the
  doc bloat bought neither correctness nor fidelity (and on fin-middleware tracking the heavy control
  itself dropped corrections the slim arms kept).
- **The win is structural, not a specific shape.** The top slim arm changes by app — turbo-a (BTW &
  fin-middleware) vs aidlc-turbo (procesbeheer) — but **a slim shape wins every run and the heavy
  control never does.** Write each load-bearing fact once in the builder-facing doc and link, rather
  than restate (heavy) or defer behind an unresolved hop (lean).
- **aidlc-turbo is the robust cross-intent default; turbo-a wins on review economy.** aidlc-turbo is the
  only arm strong across all three runs (never below 8.4 overall where built); turbo-a is leanest and
  highest-quality where it leads but is more sensitive to per-build slips. Pick aidlc-turbo to lock one
  shape; turbo-a when review burden binds.
- **Doc shape discriminates where the logic is hardest** (service/engine/tracking) and is noisy on
  thin/delegation work (UI / MED-complexity polling) — where the two real per-build slips landed.

**Cross-app generalization: CONFIRMED.** The thesis survived leaving ViewPoint. Remaining gate before
adopting a slim shape into the flow: fold the two flow gates run 2 recommended (idiom/lint-gate +
caveat-inline-check) so no arm regresses what the panels flagged.

## Per-run folder contents

Each `YYYY-MM-<run>/` holds: `overview.html` (the frozen results artifact — open in a browser or
re-publish as a Claude artifact), `stage-a.md`, `stage-b.md` (the verdict), `README.md` (self-contained
snapshot summary), and run 2 also keeps its `RUN.md` log. The large/proprietary `arms/` doc trees and
raw ViewPoint source diffs stay in the gitignored `evals/doc-slimming/` workspace — regenerate from the
playbook if a rerun needs them.
