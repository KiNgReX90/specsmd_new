# Stage A — procesbeheer + koppellaag (full 7-bolt program)

Cheap funnel stage: **doc economy** + **caveat survival** + the **hard gate**. Decides which
arms earn a (costly) Stage-B build. Method: `evals/notes/doc-slimming-eval-framework.md`.
This is the full-intent generalization check (TP-6) — does the BTW ranking hold on a bigger,
broader intent (2 intents, 7 bolts, 19 stories) or did we overfit?

## 1. Doc economy (the "review too much" axis)

Measured over each arm's full shipped doc set (`measure-docs.sh` + `restatement.py`).

| arm | files | lines | ~tokens | vs aidlc | excess restatement† | R |
|---|---:|---:|---:|---:|---:|---:|
| **aidlc** (heavy ref) | 53 | 4789 | 60.5K | — | 677 | 17.93 |
| aidlc-turbo | 28 | 1282 | 18.8K | −73% | 226 | 6.65 |
| **turbo-a** | 9 | 835 | 16.8K | **−83%** | **138** | 4.45 |
| turbo-b | 27 | 1297 | 20.6K | −73% | 237 | 6.92 |
| openspec | 16 | 1416‡ | 20.1K | −70% | 300 | 8.50 |
| inferno (lean) | 8 | 268 | 3.7K | −94% | 55 | 2.33 |
| inferno-full | 27 | 1231 | 14.0K | −74% | 241 | 7.00 |

† excess = restatements beyond write-once (mentions − facts_present); a true write-once doc ≈ 0.
‡ openspec splits into **843 one-time baseline `specs/` + 573 per-change `changes/`** — the recurring
review burden is the 573 (−88% vs aidlc); the baseline amortizes across all future changes.

The heavy reference restates each of the 40 load-bearing facts ~18× (excess 677). Every reshape
collapses that toward write-once (excess 55–300). turbo-a is the leanest *complete* arm.

## 2. Caveat survival (the correctness axis) + HARD GATE

25 load-bearing caveats (23 real + 2 synthetic plants). One **blind** checker per arm read **only
that arm's shipped doc set** and judged each caveat PRESENT / MANGLED / ABSENT against the
*discriminating* fact (not just the topic). Uniform rule: do not follow links outside the shipped
set — a caveat reachable only via an unresolved link is ABSENT. Gate passes only at **100%** survival.

| arm | present | mangled | absent | survival | GATE |
|---|---:|---:|---:|---:|:--|
| **aidlc** (heavy ref) | 25 | 0 | 0 | **100%** | ✅ PASS |
| **aidlc-turbo** | 25 | 0 | 0 | **100%** | ✅ PASS |
| **turbo-a** | 25 | 0 | 0 | **100%** | ✅ PASS |
| **turbo-b** | 25 | 0 | 0 | **100%** | ✅ PASS |
| openspec | 23 | 2 | 0 | 92% | ⚠️ NEAR-MISS |
| inferno-full | 13 | 7 | 5 | 52% | ❌ FAIL |
| inferno (lean) | 10 | 6 | 9 | 40% | ❌ FAIL |

### Failed/mangled caveats by arm

**openspec (2 mangled — both medium severity, topic survived but mechanics dropped):**
- `filtered-choice-list-per-dagboektype` — FACTURATIE→Betalingen / MEMORIAAL→Grootboek mapping +
  INACTIEF-stays-selectable present, but the **fail-closed rule (unknown VP-type → EMPTY list)** dropped.
- `viewpointentity-tcn-log-briu-trigger` — BRIU triggers + `get_sequence` (not `.nextval`) present,
  but the **trigger mechanics** (`tcn=:old.tcn+1` else raise -20000; insertable=false; raw-JDBC must
  send `tcn=old+1`) dropped.
  Note: aidlc-turbo, turbo-a and turbo-b all captured *both* of these → the loss is specific to
  openspec's delta-spec authoring, not an inherent slim-shape limit.

**inferno-full (52%) — context manifest resolves stories, deep caveats live in ADRs not enumerated:**
- ABSENT (5): `vpfa-fdgb-on-delete-cascade` (cross-intent trap), `anti-corruption-payload-stub-list`,
  `itask-not-spring-scheduled`, `adapter-columns-excluded-on-overname`, `synth-proceslijst-sort-order`.
- MANGLED (7): cascade-restrict-asymmetry, prolongatieperiode-stays-not-null, soort-ui-only-no-column,
  vervallen-columns-hidden-not-dropped, list-filter-scope-on-proces-type, filtered-choice-list,
  viewpointentity-tcn-log-briu.

**inferno (40%) — pointer-only; most detail behind unresolved source links:**
- ABSENT (9): prolongatieperiode-stays-not-null, soort-ui-only-no-column, vpfa-fdgb-cascade,
  overlap-definition-open-ended, anti-corruption, itask-not-spring, fea-id-varchar-not-number,
  viewpointentity-tcn-briu, adapter-columns-excluded.
- MANGLED (6): cascade-restrict-asymmetry, vervallen-columns-hidden, list-filter-scope, relevance-filter,
  synth-proceslijst-sort-order, synth-overzicht-sort-order.

### Synthetic plants behaved exactly as designed
The 2 fabricated low-salience sort rules discriminate preservation fidelity independent of whether the
real traps survived:

| plant | aidlc | aidlc-turbo | turbo-a | turbo-b | openspec | inferno-full | inferno |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| synth-proceslijst-sort-order | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ~ |
| synth-overzicht-sort-order | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ |

Faithful write-once+rewrite shapes carried both verbatim; the lean pointer shapes dropped/mangled them.

## 3. Why the lean shapes fail (and the rewrites don't)

The lean pointer shapes (inferno, inferno-full) delegate caveat-preservation to a **context manifest
that operates at story granularity**. The story-level files themselves defer the deep technical
decisions to ADRs ("FK-gedrag afstemmen — ADR"), and the manifest never enumerates those ADRs. The
pointer chain breaks at exactly the load-bearing link. This is a faithful property of the shape, not a
generation gap — verified directly in the `context.required` blocks.

The slim **rewrite** shapes (aidlc-turbo decision ledger, turbo-a fused items, turbo-b source-of-truth
stories) actively fold every load-bearing caveat into the doc the builder acts on → 100% survival at
73–83% fewer lines. That is the whole thesis: write each load-bearing fact ONCE, in the doc, and link
to it — never restate, never defer it behind an unresolved hop.

## 4. Stage-A gate verdict

- **Pass at 100%:** aidlc (heavy control), aidlc-turbo, turbo-a, turbo-b.
- **Near-miss (92%):** openspec — 2 medium mechanics dropped.
- **Fail:** inferno-full (52%), inferno (40%).

Directionally identical to BTW: heavy + faithful-rewrites preserve everything; lean pointer controls
are lossy. The new datapoint vs BTW: **turbo-b** (source-of-truth stories + thin pointers) also makes
100%, and **openspec** slipped from clean-pass (BTW) to a 92% near-miss on this deeper intent — its
delta-spec shape is slightly less robust at carrying implementation-mechanics caveats.

## 5. Recommended Stage-B cohort

Build the survivors with the canonical TDD-gated builder, DB-free, on the frozen bases
(procesbeheer 002/003/004 on `2768f4fcd65`; koppellaag 007 on `2d1310e9208`):

- **Controls (carried regardless of gate, to anchor the comparison):** `aidlc` (heavy "review too
  much" baseline), `inferno` (lean lossy baseline).
- **Passing slim arms (100% survival):** `turbo-a`, `aidlc-turbo`, `turbo-b`.
- **Open question — `openspec`:** strict gate holds it out (92%), but building it would *test whether
  the 2 dropped caveats actually become real build defects* — a direct validation of whether the
  caveat-survival metric predicts build quality. Worth +1 arm if budget allows.

5 arms × 4 buildable bolts = 20 builds (24 if openspec is included).
