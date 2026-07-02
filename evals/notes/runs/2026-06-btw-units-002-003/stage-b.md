# Stage B results — build head-to-head + judge panel

**Date:** 2026-06-25
**Scope:** BTW intent, units 002+003. Three Stage-A survivors built by the same canonical TDD-gated
`specsmd-inferno-builder`, sequentially (shared `~/.m2`), off base `6e1259fb7cf`. Real INFERNO build
(`inferno-test/btw-stamgegevens-real-builders`) carried as the control.

## Builds (all green, TDD proven from transcripts)

| arm | compile | DB-free UTs | caveats honored | TDD (skill · RED→GREEN) |
|---|---|---:|---|---|
| openspec | EXIT=0 | 34 | 10/10 | yes · 17→36 |
| aidlc-turbo | EXIT=0 | 40 | 10/10 | yes · 7→42 |
| turbo-a | EXIT=0 | 36 | 10/10 | yes · 14→16 |
| INFERNO (control) | (prior real build) | 48 | 8/10* | prior run |

\* The control fails caveat 9 in practice — see the panel finding below.

Pre-existing base toolchain gaps (vp-biz `BASE64DecoderStream`, vp-common-all `ExcelRowProducer`
Record-ambiguity) affect all arms equally; builders verified VAT logic against the installed `~/.m2`
jars and noted it. Not build defects.

## Judge panel — 3 blind judges, 8-dim weighted 0-10 rubric

Arms presented as anonymized diffs (arm-1..arm-4, shuffled). Distinct lenses for independence; each
scored all 8 dimensions. De-anonymized after.

| arm | A: corr/rob | B: idiom/arch | C: test/fid | **mean composite** | spread |
|---|---:|---:|---:|---:|---:|
| **turbo-a** | 8.93 | 8.45 | 8.58 | **8.65** | 0.48 |
| **aidlc-turbo** | 8.58 | 8.42 | 8.66 | **8.55** | 0.24 |
| **openspec** | 8.24 | 7.72 | 7.83 | **7.93** | 0.52 |
| INFERNO (control) | 7.18 | 7.06 | 5.97 | **6.74** | 1.21 |

### The headline: all three slim reshapes beat the lean control

The single biggest finding is that the **actual prior INFERNO build lost to all three slimmed
reshapes** — and not narrowly. Why, per the judges (independently, blind):

1. **The control carries a real, load-bearing C-9 defect.** Judges A and C both found that
   `VATDetails.details()` (the calculation path) resolves on `MAX(btwt_startdatum) <= peildatum` with
   **no einddatum cap**, while only the keuzelijst path is capped via the view. An expired tarief can
   feed real VAT math. This is the `VATDetails.java:109` bug from the A2 verdict — and the three
   reshape arms, built test-first, **capped einddatum on both paths**. So the slim plans produced
   *more correct* code than the lean baseline.
2. **The control has idiom/architecture debt the reshapes avoid.** An en-dash string literal compiled
   into Java source, ~40 non-ASCII comment lines, a battery of Dutch user strings stranded in the
   `moca.database` persistence layer (`BtwBlokkeerActie`/`BtwVerwijderActie`), and an N+1 query on the
   overview. Judge B scored it 3.5 on idiom vs 7.0-9.0 for the reshapes.
3. **The control is thinly tested.** Only ~5 DB-free tests (grep/reflection guards); its pure helpers
   are written but unasserted. The reshapes carry 34-40 meaningful DB-free UTs.

### Among the reshapes: build quality diverges from doc economy

- **turbo-a (8.65) wins build quality** — both read paths capped with correct triple-bind, the only
  arm to reason in-code about the legacy column-4 parity inversion, finest pure-helper separation.
- **aidlc-turbo (8.55) is a hair behind and the most consistent** (spread 0.24) — highest meaningful
  DB-free coverage (incl. a real HALF_UP-vs-HALF_EVEN discriminator and SQL-shape tests on both
  paths), tightest single-DAO design, only arm to isolate a DB-gated IT.
- **openspec (7.93) is third on built code**, despite leading Stage-A doc economy. Judges flagged: a
  thinner overview (no live actueel-tarief resolution → weaker second read-path), no ROUND_HALF_UP
  guard test, an invented `J/N` decode assumption, and correctness partly outsourced to the unit-001
  view. Its idiom was the cleanest (ASCII-only), but the build did not convert its planning-economy
  lead into a code-quality lead.

## The Pareto verdict

Plotting build quality (panel mean) against Stage-A doc economy — both 0-10:

| arm | doc economy (Stage A) | build quality (Stage B) | gate (build green + caveats 100%) |
|---|---:|---:|---|
| **openspec** | **9.27** | 7.93 | PASS |
| **aidlc-turbo** | 8.80 | 8.55 | PASS |
| **turbo-a** | 8.09 | **8.65** | PASS |
| INFERNO (control) | 3.53 (honest) | 6.74 | **FAIL** (C-9) |
| AI-DLC (control) | 0.00 | (descoped; not re-judged) | **FAIL** (C-1, C-9) |

**All three reshapes sit on the Pareto frontier — none dominates the others.** The pick is an
explicit economy-vs-quality choice, and crucially *every option beats both controls on both axes*:

- **Lowest review burden → OpenSpec.** 539 change-only review lines, cleanest caveat survival via
  scenarios, ASCII-clean. Best when human review cost is the binding constraint; accept a slightly
  thinner build that a good reviewer closes.
- **Best built code → turbo-a.** Highest panel quality, both paths capped, finest test seams. Best
  when build correctness dominates and a ~20% larger doc surface is acceptable.
- **Best balance → aidlc-turbo (recommended default).** 2nd on economy (8.80) and 2nd on quality
  (8.55) with the lowest judge spread — the all-rounder, and the smallest change to today's AI-DLC
  structure (drop ceremony, keep trimmed stories + a decisions ledger).

## Thesis read-out

**Confirmed, strongly.** You can cut **~65-70% of the planning docs** and not only keep build quality
but *improve* it: the three slim reshapes each scored **8.0-8.7** and fixed the einddatum defect that
the heavyweight-sourced lean baseline shipped (6.74, gate-fail). The doc-bloat bought neither
correctness nor fidelity. The win is structural — write-once, caveats-as-first-class, in-workspace
links — exactly what the cheap Stage-A gate predicted before a line was built.

Recommended next step: adopt **aidlc-turbo** as the default slim shape (lowest-friction migration from
AI-DLC), with **OpenSpec's delta+scenario discipline** as the direction of travel where capability
specs can accumulate — and fold the einddatum-cap + idiom/lint gates into the flow so no arm can
regress them.
