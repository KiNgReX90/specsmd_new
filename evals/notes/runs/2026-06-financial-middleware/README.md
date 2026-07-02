# Run #3 — financial-middleware · message-translation (cross-app leg)

Self-contained snapshot of the doc-slimming eval's **cross-app generalization leg** (TP-6 third leg):
does the BTW/procesbeheer ranking survive leaving ViewPoint? **Yes — confirmed.**

- **Why** (method/rubric/gates): [`../../doc-slimming-eval-framework.md`](../../doc-slimming-eval-framework.md)
- **Cross-run index:** [`../README.md`](../README.md)
- **Full verdict:** [`stage-b.md`](stage-b.md) · **economy + gate:** [`stage-a.md`](stage-a.md) ·
  **raw panel numbers:** [`judge-aggregate.txt`](judge-aggregate.txt) · **artifact:** [`overview.html`](overview.html)

## Setup

- **App / stack:** financial-middleware — Java 21 / Spring Boot 3.4.3 / Maven multi-module / in-memory
  queue / Oracle + Elasticsearch. Package `nl.decxit.adapter`. A genuinely different app, stack, team
  and domain than ViewPoint (JDK8 / Vaadin-domui / moca).
- **Material:** intent `001-message-translation`, run as **3 unit-runs across a complexity gradient** —
  polling (MED), engine (HIGH), tracking (caveat-dense, low code). Only intent 001 was fully constructed
  in the app, so it was the only comparable, reproducible material (the planned 4-intent fan-out
  collapsed to this single 3-unit run).
- **Held constant from runs #1/#2:** the 7 arm doc-shapes, harness scripts, the weighted 8-dim 0–10
  rubric, the Stage A→B funnel + 2 hard gates, the single canonical TDD-gated `specsmd-inferno-builder`,
  and the blind 3-lens judge protocol. Only the app + intent changed.
- **16 builds**, all green (engine ×6 · polling ×5 · tracking ×5), DB-free, each in an isolated worktree
  off the unit's frozen base + a hardlink-cloned private maven repo. The tracking wave was interrupted by
  an API timeout mid-TDD; the 3 affected builders were resumed from transcript to GREEN and the whole
  wave was then independently re-verified clean-room (EXIT=0 / 0F / 0E each).

## Result (build quality = blind 3-lens weighted 0–10 panel; economy = Stage-A 0–10)

| arm | engine | polling | tracking | overall | doc-econ | gate | |
|---|---:|---:|---:|---:|---:|:--|---|
| **turbo-a** | 8.97 | 7.63 | 9.16 | **8.58** | 9.3 | PASS | ★ dominates field on both axes (−91% docs) |
| AI-DLC (heavy) | 8.89 | 8.24 | 8.17 | **8.43** | 0.0 | PASS | **Pareto-dominated** |
| aidlc-turbo | 8.78 | 7.18 | 9.29 | **8.42** | 8.3 | PASS | ties heavy @ −81% docs; robust #2 |
| inferno-full | 7.93 | 6.91 | 6.87 | **7.24** | 7.8 | **FAIL** | honest-lean; link-set gaps |
| turbo-b | 7.64 | 4.77 | 8.57 | **7.00** | 8.8 | PASS | polling source-mutation defect |
| INFERNO (lean) | 3.07 | — | — | **3.07** | 10.0 | **FAIL** | **hollow** engine build |

**Pareto frontier = {turbo-a}** — the single leanest *complete* arm is also the highest-quality build,
sharper than either ViewPoint run. Inter-judge spread ≤ 1.4, no ranking inverted (no re-adjudication).

## Headline findings

1. **The hollow lean control is the sharpest signal yet.** INFERNO's engine compiles with 45 green
   tests but is an opaque pass-through — zero Visma field mappings, strategy as an interface not the
   required abstract class, tests that can never go RED (Corr 2.0 / Cav 1.2 / Fid 1.5). Caveat-loss in
   the plan → a green-but-empty build, on a third app. Stage A (13/36 facts, gate-FAIL) called it first.
2. **The heavy AI-DLC control is Pareto-dominated for the 3rd run running.** turbo-a beats it on both
   economy (9.3 vs 0.0) and quality (8.58 vs 8.43) at 91% fewer doc lines. On tracking the heavy control
   itself dropped the DEGRADED-registration + record-null-validation corrections that the slim arms kept.
3. **turbo-a reproduces BTW (run #1), not procesbeheer (run #2).** The top slim arm changes by app, but
   a slim shape wins every run — the win is structural (write-once-and-link), not one specific shape.
4. **The honest-lean control is hostage to its link set.** inferno-full gate-fails and builds worse
   (7.24): its work-items linked the inception stories but not the construction-time fix layer, so the
   build lost exactly those caveats (no DEGRADED reg, dropped `btw_geblokkeerd_yn→notValidAfter`).
5. **Logic-heavy units discriminate; MED polling is noisy.** turbo-b's polling build (4.77) writes
   `PROCESSING` back to the read-only ViewPoint source — a forbidden mutation; gate-pass, build-slip.

## Read-out

Cross-app generalization **confirmed**: heavy control Pareto-dominated, lean control worst + gate-fail,
a slim shape wins — now true across **3 runs / 2 apps / 2 stacks**. Recommendation unchanged from run #2:
adopt a slim shape (aidlc-turbo as the safe cross-intent default; turbo-a where review burden binds), and
fold an idiom/lint-gate + caveat-inline-check into the flow before adoption so no arm regresses what the
panels flagged. **Nothing pushed to remote (company-sensitive).**
