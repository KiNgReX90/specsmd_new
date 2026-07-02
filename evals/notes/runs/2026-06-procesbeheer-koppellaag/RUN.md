# Doc-slimming run #2 — procesbeheer + koppellaag (full 7-bolt program)

Second run of the doc-slimming eval (the first was BTW units 002+003). Method/why:
`evals/notes/doc-slimming-eval-framework.md`; how-to: `evals/notes/doc-slimming-replay-playbook.md`.
This run is the **full-intent generalization check (TP-6)** — does the BTW ranking hold on a
bigger, broader intent, or did we overfit?

## Scope (confirmed with user 2026-06-25)
- **Two intents, 7 bolts, 19 stories.** AI-DLC reference = real, shipped docs (the premise the
  user set: "AI-DLC is the reference"). Reference assembled from `origin/bolt-006-koppellaag-service`
  (the superset branch carrying both intents + all 7 bolts) into `arms/aidlc/`.
- AI-DLC heavy reference economy: **53 files, 4788 lines, ~60K tokens** (vs the much smaller BTW slice).

## Bolts + build states (from origin/bolt-006-koppellaag-service)
| bolt | unit | AI-DLC status | Stage-B role |
|---|---|---|---|
| 001 procesbeheer-service | svc | complete | base for 002 |
| 002 procesbeheer-service | svc | planned | **BUILD** |
| 003 procesbeheer-ui | ui | planned | **BUILD** |
| 004 procesbeheer-ui | ui | planned | **BUILD** |
| 005 koppellaag-service | svc | complete | base for 007 |
| 006 koppellaag-service | svc | complete | base for 007 |
| 007 koppellaag-ui | ui | planned | **BUILD** |

## Frozen bases (Stage B)
- procesbeheer 002/003/004 build on **bolt-001** `2768f4fcd65` (local branch `bolt-001-procesbeheer-service`).
- koppellaag 007 builds on **bolts 005+006 built** `2d1310e9208` (HEAD of `origin/bolt-006-koppellaag-service`).
- DB-free verification only (no Oracle — DC_714 docker exec denied): compile offline + DB-free UTs;
  ITs compiled-not-run. JDK8 `/usr/lib/jvm/jdk1.8.0_431`, mvn 3.9.9 `-o -Denforcer.skip=true`,
  install moca.database first.
- Do NOT touch the live `inferno-intent/001-procesbeheer-vp-processen` worktree or any other session's worktree.

## Controls authored (Phase 0b — held constant across arms)
- `facts/procesbeheer-koppellaag.yaml` — 40 distinct load-bearing facts (restatement metric).
- `caveats.yaml` — 23 real load-bearing caveats (10 procesbeheer + 13 koppellaag) + 2 synthetic plants.
- `ac-checklist.md` — frozen normative AC, flow-neutral, grouped by bolt (buildable: 002/003/004/007).

## Held constant from BTW (do NOT change, or it's a new experiment, not a replay)
- The arm doc shapes (§2 of the playbook), the harness scripts, the 0-10 rubric + weights,
  the Stage A->B funnel + 2 hard gates, the canonical TDD-gated builder, the blind 3-judge protocol.
- `restatement.py` gets backward-compatible ARMS_ROOT/FACTS_FILE env overrides (defaults unchanged,
  so the BTW run stays byte-reproducible).

## Phase status
- [x] Phase 0a — assemble AI-DLC reference (`arms/aidlc/`, 53 files / 4788 lines).
- [x] Phase 0b — author facts + caveats + AC checklist.
- [x] Phase 0c — generate slim arm doc sets (+turbo-b) + seed 2 synthetic plants into the reference.
- [x] Phase 1 — Stage A (doc economy + caveat survival + gate). Results: `results/stage-a.md`.
      PASS 100%: aidlc, aidlc-turbo, turbo-a, turbo-b. NEAR-MISS 92%: openspec.
      FAIL: inferno-full 52%, inferno 40%.  <-- STOP for user go on Stage-B cohort
- [x] Phase 2 — Stage B COMPLETE. 5 arms × {pb 002+003+004, kl 007} = **10/10 GREEN** (table above).
      Canonical specsmd-inferno-builder, real TDD RED→GREEN, DB-free verify, ownership respected.
      Run PARALLEL (4 concurrent), each in a hardlink-cloned isolated maven repo (build-recipe.md
      "Parallel execution") — killed the shared-~/.m2 race without changing build semantics.
      Recipe pinned: mvn8 Java-8 classworlds launcher (bare `mvn` runs Java 21!).
      <-- STOP for user go on Phase 3 (per phase-by-phase cadence)
- [x] Phase 3 — COMPLETE. 10 shuffled anonymized diffs → judge/; blind 6-judge panel (3 lenses × 2
      stacks), 8-dim weighted rubric vs frozen ac-checklist.md + caveats.yaml. Verdict in results/stage-b.md,
      snapshot in evals/notes/runs/2026-06-procesbeheer-koppellaag/.
      VERDICT: aidlc-turbo 8.06 (Pareto-DOMINATES heavy aidlc 7.67 on both axes, −73% docs) · turbo-a 7.60
      (frontier, −83% docs) · turbo-b 7.32 · inferno(lean) 6.96 gate-FAIL (wrong soort col/list col/unwired
      delete guard). Frontier={aidlc-turbo best quality, turbo-a best economy}. Generalizes from BTW;
      turbo-a did NOT repeat #1 (kl double-encode) → aidlc-turbo = robust cross-intent default.
- [ ] Phase 4 (future) — TP-6 third leg: financial-middleware cross-APP check (see todo.md), 4 intents.

## Stage-B build matrix (5 arms x {pb-stack 002+003+004 @2768f4fcd65 | kl-007 @2d1310e9208})
Worktrees: `.worktrees/pbkl-eval-<arm>-{pb,kl}` (mirror of btw-eval naming). Base smoke worktrees: pbkl-base-{pb,kl}.
Record per build: compile EXIT · DB-free UT pass · TDD RED→GREEN · ownership-respected.
**Parallel run (2026-06-25):** builds now run concurrently, each in a private hardlink-cloned maven
repo (`/home/ruben/.m2-eval-clones/<arm>-<stack>/repository`, `-Dmaven.repo.local`) so the shared-`~/.m2`
race is gone — see build-recipe.md "Parallel execution". RAM-capped at ~4 concurrent maven builds.
| arm | pb 002+003+004 | kl 007 |
|---|---|---|
| turbo-a      | [x] GREEN · EXIT0 · vp-biz 1650/0fail +20 UT · vp-domui 127pass(+4) · TDD 20+4 R→G · commit e6e1d62 | [x] GREEN · EXIT0 · vp-domui 136pass(+13) 0regress · TDD 13 R→G · commit d175f22 |
| aidlc-turbo  | [x] GREEN · EXIT0 · vp-biz 002 13/0fail (+13 UT) · vp-domui 130pass(=123+7) 0regress · TDD 13+7 R→G · commit 8411b8a | [x] GREEN · EXIT0 · vp-domui 210/0fail (+9 UT KoppelingOverzichtView) 0regress · TDD 9 R→G · commit 23b9741 |
| turbo-b      | [x] GREEN · EXIT0 (vp-biz/vp-domui/viewpoint) · +18 UT (BizProcesbeheer 13 + SectieLogica 5) 0regress · TDD 13+5 R→G · commit 22fba7c · ⚠FIDELITY: put ProcesSoort in moca.database (outside 002/003/004 ownership); verified via targeted tests + test-compile (full mvn test hung on Oracle) | [x] GREEN · EXIT0 · vp-domui 214/0fail (+13 UT: 6+7 view-models) 0regress · TDD 13 R→G · commit 7d8f82e |
| aidlc (ctrl) | [x] GREEN · EXIT0 · vp-biz 1642/0fail (+12 UT BizProcessManagement) · vp-domui 130pass(=123+7) 0regress · TDD 12+7 R→G · commit 69f464d · ownership clean (no moca spill) | [x] GREEN · EXIT0 · vp-domui 209/0fail (+8 UT: 5+3) 0regress · TDD 8 R→G · commit 41f995f · caught surefire *UT-never-runs, renamed →*Test |
| inferno (ctrl)| [x] GREEN · EXIT0 · vp-biz +10 UT BlProcesbeheer · vp-domui 216/0fail 138pass(=123+15) 0regress · TDD 10+6+9 R→G (genuine breaks shown) · commit 92c00e7 · ⚠DIVERGENCE: soort mapped off BPS_INDELING_SOORT/arrangementType (turbo-b+aidlc used BPS_PROCES_TYPE="PROLONGATIE") — caveat-loss→interpretation drift | [x] GREEN · EXIT0 · vp-domui +9 UT KoppellaagOverzichtView · test-compile clean · 0regress · TDD 7+2 R→G · commit 78f12ef · pages in vp-domui-components (no viewpoint menu hook DB-free) |

### ★ Stage-B COMPLETE — 10/10 GREEN. All branches verified (HEAD + non-empty additive diff vs frozen base):
| branch | HEAD | base | diff |
|---|---|---|---|
| turbo-a-pb | e6e1d62 | 2768f4f | 9 files +869 |
| turbo-a-kl | d175f22 | 2d1310e | 10 files +832 |
| aidlc-turbo-pb | 8411b8a | 2768f4f | 9 files +894 |
| aidlc-turbo-kl | 23b9741 | 2d1310e | 6 files +671 |
| turbo-b-pb | 22fba7c | 2768f4f | 9 files +748 |
| turbo-b-kl | 7d8f82e | 2d1310e | 8 files +849 |
| aidlc-pb | 69f464d | 2768f4f | 6 files +777 |
| aidlc-kl | 41f995f | 2d1310e | 9 files +772 |
| inferno-pb | 92c00e7 | 2768f4f | 10 files +953 |
| inferno-kl | 78f12ef | 2d1310e | 7 files +729 |
All diffs 0 deletions → purely additive (no regression by construction). Every arm: real TDD RED→GREEN,
DB-free verify, ownership respected (1 noted spill: turbo-b ProcesSoort→moca.database).

PHASE-3 WATCH (flags for the blind judges to test against caveats + AC):
- inferno-pb soort mapped off BPS_INDELING_SOORT/arrangementType vs turbo-b+aidlc BPS_PROCES_TYPE="PROLONGATIE" — candidate lean-control defect.
- inferno arm built WITHOUT the deep caveats (Stage-A 40% survival) — does that show up as wrong/missing behavior vs the 100%-survival arms?
- turbo-b ProcesSoort placed in moca.database (outside its 002/003/004 ownership).
- Per-arm "details the docs did NOT specify" lists (phase-transition graph, cascade-vs-block classification,
  EFA keuzelabel, sort order) — compare interpretations across arms for divergence = doc-shape signal.
NOTE (verification integrity): surefire runs only *Test/*IT, NOT *UT. All 8 finished builds' new
tests use *Test/*UnitTest (→ run); aidlc-kl initially used *UT, caught it, renamed →*Test. So every
arm's new UTs genuinely executed — no silently-skipped green.
