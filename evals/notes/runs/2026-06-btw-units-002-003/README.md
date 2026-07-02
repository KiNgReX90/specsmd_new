# Doc-slimming run snapshot — BTW, units 002+003 (2026-06)

Frozen record of the **first** doc-slimming eval, kept on-branch so a later run on a **full intent**
(or a second intent) can be compared against it. Method and procedure live in
[`../../doc-slimming-eval-framework.md`](../../doc-slimming-eval-framework.md) (the *why*) and
[`../../doc-slimming-replay-playbook.md`](../../doc-slimming-replay-playbook.md) (the *how* — use this
to run the next one).

## Scope of THIS run — read before comparing

This was **one intent, a slice of it** — not a full intent, and not multiple intents:

- **Intent:** BTW-stamgegevens (ViewPoint) — a single feature.
- **Units covered:** **002** (VAT calc refactor) + **003** (DomUI beheerpagina) ≈ **10 buildable items**.
- **Base commit:** bolt-002 `6e1259fb7cf` — unit **001** (the SQL backend) was **already built** in the
  base and was the given starting point, *not* re-tested.
- So: a **2-unit slice off a pre-built base**, single feature. The leanest economy numbers and the
  caveat set are scoped to those 10 items.

**What a "full intent" comparison run would add** (and why it may move the numbers): unit-001 built
from scratch too (more docs, more caveats, the OpenSpec baseline cost paid for real), and ideally a
**second intent** (procesbeheer) to check the ranking isn't a BTW artifact (framework TP-6/TP-7).
Don't compare raw line counts 1:1 — compare the *shape* of the result: do the slim arms still beat
both controls, is the Pareto ranking stable, does caveat-survival still gate the same arms out.

## What's in here

| File | What it is |
|---|---|
| `overview.html` | The results artifact (open in a browser). Same content as the published Claude artifact. |
| `stage-a.md` | Stage A — doc-economy + caveat-survival, no builds. The cheap gate. |
| `stage-b.md` | Stage B — 3 real TDD builds + blind 3-judge panel + the Pareto verdict. |
| `inputs/caveats.yaml` | The 10 load-bearing caveats this run gated on. |
| `inputs/facts/btw.yaml` | The distinct load-bearing facts for the restatement metric. |
| `inputs/harness/` | `measure-docs.sh` + `restatement.py` — the Stage-A measurement scripts. |

**Not committed** (kept only in the gitignored `evals/doc-slimming/` workspace): the seven `arms/`
doc trees and the `judge/*.diff` raw ViewPoint source diffs — large and proprietary source. The
writeups above carry the conclusions; regenerate the arms from the playbook if a rerun needs them.

## Headline result (so the snapshot is self-contained)

Codequality (blind 3-judge, weighted 0–10) vs. Stage-A doc economy:

| arm | doc economy | build quality | gate |
|---|---:|---:|---|
| turbo-a | 8.09 | **8.65** (best code) | PASS |
| aidlc-turbo ⭐ | 8.80 | 8.55 (best balance, recommended) | PASS |
| openspec | **9.27** (lowest review burden) | 7.93 | PASS |
| INFERNO (control) | 3.53 | 6.74 | **FAIL** (caveat C-9) |
| AI-DLC (control) | 0.00 | (descoped) | **FAIL** (C-1, C-9) |

**All three slim reshapes beat both controls.** Cutting ~65–70% of the planning docs improved build
quality rather than hurting it; the win is structural (write-once + caveats-as-scenarios + in-workspace
links), not volume. The cheap build-less Stage A predicted both real build bugs before a line was built.
