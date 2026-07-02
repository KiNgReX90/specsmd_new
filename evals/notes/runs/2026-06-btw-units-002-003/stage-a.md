# Stage A results — doc-slimming eval (cheap filters, no builds) — CORRECTED

**Date:** 2026-06-24
**Scope:** BTW intent, units 002 (VAT refactor) + 003 (DomUI beheerpagina) — the 10 buildable items.
**Arms:** aidlc (control) · aidlc-turbo · turbo-a · turbo-b · inferno (control) · openspec.
**Ran:** TP-2 (doc-economy + de-confounded restatement) and TP-3 (caveat-survival). TP-5 review-diff as a proxy.

## Correction applied (the "fix everything" pass)

The first cut unfairly crippled the **INFERNO** arm: I copied only `brief.md` + `work-items/`, omitting
the `context.required` story link-targets a real INFERNO builder actually has in its workspace. Two
arms now represent INFERNO honestly:
- **`inferno` (lean/lossy)** = work-items only — what INFERNO *nominally* emits.
- **`inferno-full` (honest)** = work-items + the resolved `memory-bank/.../stories/*.md` link-targets —
  what a builder actually consumes.

Also de-confounded the restatement metric (added `excess` = restatements beyond one-each, which does
not reward splitting into many files). The AI-DLC / aidlc-turbo caveat *failures* are kept as honest
findings, not patched away.

---

## TP-2 — doc-economy (7 arms)

| arm | files | lines | ~tokens | review-diff | restatement: mentions / excess / R |
|---|---:|---:|---:|---:|---:|
| **aidlc** (control) | 17 | 2181 | 35.8k | 2181 | 174 / 156 / 9.67 |
| **inferno** (lean, *lossy*) | 11 | 661 | 7.9k | 661 | 71 / 54 / 3.94 |
| **inferno-full** (honest) | 21 | 1555 | 23.8k | 1555 | 154 / 136 / 8.56 |
| **openspec** | 8 | 740 | 10.0k | **539** (+201 1-time baseline) | 87 / 69 / 4.83 |
| **aidlc-turbo** | 12 | 633 | 11.5k | 633 | 102 / 84 / 5.67 |
| **turbo-a** | 12 | 797 | 12.8k | 797 | 105 / 87 / 5.83 |
| **turbo-b** | 22 | 867 | 13.1k | 867 | 144 / 126 / 8.00 |

**Doc-economy composite** (mean of lines, tokens, excess, review-diff; each normalized 0–10, 10 = leanest):
inferno-lean **9.77*** · openspec **9.27** · aidlc-turbo **8.80** · turbo-a **8.09** · turbo-b **6.89** ·
inferno-full **3.53** · aidlc **0.00**.
\* inferno-lean scores top **only because it is lossy** — it fails the caveat gate standalone (below).

---

## TP-3 — caveat-survival (the hard gate), independently judged

| # | caveat | aidlc | aidlc-turbo | turbo-a | turbo-b | inferno (lean) | inferno-full | openspec |
|---|---|---|---|---|---|---|---|---|
| 1 | OQ-012: no DB column / no NOT NULL / type inert | **MANGLED** | P | P | P | **MANGLED** | P | P |
| 9 | tarief caps on einddatum on BOTH read paths | **MANGLED** | P* | P | P | **MANGLED** | P* | P |
| 2–8,10 | (all other caveats) | P | P | P | P | P | P | P |

\* soft-flag: guard text present, but the inherited story-001 SQL resolves on `MAX(startdatum) <= peildatum`
with no einddatum predicate — a careless builder copying it could still miss the cap. (turbo-a/turbo-b/
openspec *re-expressed* the rule and so do not carry the defective SQL — re-expression caught a latent source bug.)

**Gate (100% in-scope caveat-survival):**
- **PASS:** openspec (10/10) · turbo-b (10/10) · turbo-a (9/9, #7 N-A) · aidlc-turbo (10/10, soft-flag #9) · **inferno-full** (passes #1 via the resolved stories, soft-flag #9).
- **FAIL:** **aidlc (8/10)** — genuine source defect (unit-brief flattens OQ-012; SQL contradicts einddatum). **inferno-lean (8/10)** — packaging artifact: caveats live only behind links that don't resolve standalone.

---

## Findings (corrected)

1. **INFERNO's "661 lines" is an illusion.** Counted honestly — with the linked stories a builder
   actually needs — it is **1,555 lines (2.35×)**, *heavier than every reshape arm*, and it still
   **double-writes the ACs** (a lossy flattened copy in the work-item AND the full story), giving the
   highest excess-restatement (136) of any complete arm. Lean-INFERNO only looks lean if you don't
   count what it depends on; and standalone it silently drops OQ-012 + einddatum (the original near-miss).
2. **turbo-b is the honest version of INFERNO's own idea.** Same "link, never restate," but the links
   are **relative and in-workspace** and the work-items don't re-copy the AC → 10/10 caveats at 867
   lines vs inferno-full's 1,555. The lesson isn't "don't link," it's "link to something the builder
   has, and don't duplicate what you link."
3. **The bloated AI-DLC control fails the caveat gate (8/10) — volume ≠ fidelity.** OQ-012 is flattened
   in the unit-brief and the einddatum cap is contradicted by its own SQL. **The real build's
   `VATDetails.java:109` einddatum bug was latent in the AI-DLC source.** Re-expressing into scenarios
   (openspec) or clean guards (turbo-a) *fixed* that latent bug; keep-and-trim (aidlc-turbo) inherited it.
4. **The win is structural, not volume.** Cheapest *complete + gate-passing* arms: **openspec (9.27)
   > aidlc-turbo (8.80) > turbo-a (8.09)**. OpenSpec leads on the smallest review surface (539
   change-only lines) and clean 10/10 because its scenario grammar forces every caveat to be a
   first-class testable unit. This cheap, **no-build** stage already predicted the real build's two bugs.

---

## Stage-A verdict → Stage-B survivors

**Carry to Stage B (TP-1 build + TP-4 parallelism): `openspec`, `aidlc-turbo`, `turbo-a`**, with the
real INFERNO build (≈ inferno-full content) and AI-DLC bolt-005 as the two existing controls. **Drop
`turbo-b`** (dominated by turbo-a) and **`inferno-lean`** (lossy standalone; the honest INFERNO is
inferno-full, which is the existing real build).

Open question for Stage B: does OpenSpec's planning-stage lead convert to better *built code*, or do
the reshape arms converge once the same TDD builder runs on them?
