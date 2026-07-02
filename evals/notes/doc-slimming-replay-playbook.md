# Doc-Slimming Eval — Replay Playbook

**Purpose:** a step-by-step runbook to repeat the doc-slimming eval on **any new intent**, the
same way we ran it on the BTW intent. The *why* lives in [`doc-slimming-eval-framework.md`](./doc-slimming-eval-framework.md)
(arms, rubric, threats-to-validity); this file is the *how* — the literal procedure, the commands,
and the per-intent things you swap.

> One-line summary of the method: **hold the builder and the base commit constant, vary only the
> document shape, gate cheaply before you build, then build the survivors with one TDD builder and
> score the code blind.** Everything below is in service of that.

---

## 0. What you reuse vs. what you author fresh per intent

| Reuse as-is (intent-agnostic) | Author fresh for the new intent |
|---|---|
| The 6 arms (doc shapes) — §2 | The intent + its frozen base commit — §1 |
| The harness scripts (`measure-docs.sh`, `restatement.py`) | `facts/<intent>.yaml` (load-bearing facts) — §3 |
| The 0–10 quality rubric + weights (framework §2a) | `caveats.yaml` (load-bearing caveats) — §3 |
| The Stage A → Stage B funnel + the 2 hard gates | A **frozen normative AC checklist** — §1 |
| The canonical `specsmd-inferno-builder` (TDD-gated) | The build/verify recipe for the intent's repo — §5 |
| The blind 3-judge panel protocol | The arm doc sets themselves (generate per intent) — §2 |

The validity of the whole thing rests on the left column staying **byte-identical** across intents
and arms. If you change the builder or the rubric, you can't compare a new run to the BTW run.

---

## 1. Pick the intent and freeze the ground

1. **Choose one intent** that has real load-bearing caveats and a non-trivial build (a pure CRUD
   page won't discriminate the arms). BTW worked because it had the OQ-012 phantom-column trap and
   the einddatum-cap-on-both-paths trap.
2. **Freeze the base commit.** Every arm builds off the *same* commit so the diffs are comparable.
   Record it (BTW used ViewPoint `6e1259fb7cf`, the unit-001 SQL backend already in place). Create
   one git worktree per arm you intend to *build* (Stage B only), all off this base.
3. **Write the frozen normative AC checklist.** This is the single most important control. List the
   acceptance criteria *every* arm must satisfy, in flow-neutral language. Without it, a lean arm can
   look "cleaner" simply by silently building less (this confounded the original A2 verdict). Fidelity
   then measures doc-faithfulness, not divergent product decisions. Keep it next to `caveats.yaml`.

---

## 2. Produce the six arm document sets

For the new intent, generate the planning docs for each arm into
`evals/doc-slimming/arms/<arm>/`. Only the docs vary — same intent, same scope, same caveats.

| Arm | What to produce | Role |
|---|---|---|
| **aidlc** | Full AI-DLC bundle: inception-log, requirements, system-context, impact-analysis, units.md, per-unit briefs + construction-logs, per-story files. | control (status quo / heavy) |
| **inferno** | Lean INFERNO: `brief.md` + lean `work-items/` with `depends_on` / `ownership.editable` / `context.required`. **Do not** resolve the links. | control (lean) |
| **inferno-full** | The honest INFERNO: the `inferno` set **plus** the resolved `context.required` link-targets (the stories a real builder actually consumes). This is what a builder really reads. | control (honest lean) |
| **aidlc-turbo** | Drop ceremony (briefs, system-context, construction-logs); compress requirements + impact into one Decisions + Release-gates ledger; keep the trimmed story files. | slim variant |
| **turbo-a** | Trimmed requirements + a decisions ledger + **one full-fidelity item per buildable thing** (AC + edges + notes + caveats inline; deps/ownership in frontmatter). Story and work-item are the same file. | fusion (merge to one unit) |
| **turbo-b** | Story = full source of truth; work-item = thin pointer (relative in-workspace link + deps + ownership + verify-cmd), never copies the AC. | fusion (two layers, link) |
| **openspec** | Per-capability durable `spec.md` + a change folder (`proposal.md`, optional `design.md`, `tasks.md`, delta `specs/*` with ADDED/MODIFIED/REMOVED + GIVEN/WHEN/THEN scenarios). Count the one-time baseline separately. | capability-accumulation |

**Critical authoring rule for every arm:** write each load-bearing fact **once** and link/delta to it
— never restate. Restatement is both the bloat *and* the correctness risk (a lossy flattened copy is
how OQ-012 got dropped). For `openspec`, the one-time baseline capability spec is where the inception
quality re-enters; keep it in a separate file so its lines don't count against per-change economy.

---

## 3. Author the intent's facts and caveats

Two YAML files drive the cheap Stage-A measurements. Both are intent-specific.

**`facts/<intent>.yaml`** — the distinct load-bearing facts, each with `keys:` (substrings the
restatement counter greps for). Keep one entry per *fact*, not per mention. Used by `restatement.py`
to compute how many files restate each fact (excess = redundant restatements beyond one-each).

**`caveats.yaml`** — the load-bearing caveats with `id`, `statement`, `detect:` (regex/substring
list), and `severity`. These feed TP-3 and the hard caveat-survival gate. Include the real traps for
the intent *and* a couple of synthetic plants so you can tell a genuinely-preserving arm from a lucky
one. (BTW's `oq-012-no-type-column` and `einddatum-cap-both-paths` were the two that actually
separated the arms.)

Both files live under `evals/doc-slimming/` and are the only data inputs the harness reads.

---

## 4. Stage A — cheap filters (no builds), then gate

Run on **all 7 arm dirs**. This is re-runnable for ~free and is where you spend your discrimination
before paying for builds.

```bash
cd evals/doc-slimming
harness/measure-docs.sh            # files / lines / bytes / ~tokens per arm
python3 harness/restatement.py     # mdfiles / present / mentions / excess / R per arm
```

Then run **caveat-survival (TP-3)** by hand or with a checker agent: for each arm, read **only the
builder-facing artifact** (the doc a builder would actually act on — for `inferno` that's the
work-item *without* following links) and mark each caveat in `caveats.yaml` present / absent /
mangled. A caveat that only survives behind a link that doesn't resolve standalone is a **fail**, not
a pass — that's the whole point.

Record everything in `results/stage-a.md`:
- **doc-economy table** (raw vector + a normalized 0–10 composite, 10 = leanest in the set);
- **caveat-survival matrix** (arm × caveat, ✓ / ~ / ✕);
- the **gate verdict**.

**Stage-A gate (hard):** an arm passes only if **caveat-survival = 100%** of in-scope caveats in its
builder-facing doc. Carry the **top ~3 economical arms that pass the gate** into Stage B, plus the two
controls. (On BTW: drop `inferno` (lossy standalone) and `turbo-b` (dominated by `turbo-a`); the
honest INFERNO control is `inferno-full`.)

> Watch the restatement confound: `R` (avg files-per-fact) tracks file count and will unfairly
> penalize many-small-files arms. **Read `excess`, not `R`**, for the real redundancy signal.

---

## 5. Stage B — build the survivors with one TDD builder

Build each survivor + the controls with the **same** canonical `specsmd-inferno-builder` body, TDD
gate on, off the frozen base. Build **sequentially** if the arms share a single artifact cache (e.g.
ViewPoint's shared `~/.m2` — parallel installs race).

**Builder constancy is non-negotiable.** Same agent body, same base commit, same verify recipe for
every arm — only the input docs differ. If the `specsmd-inferno-builder` *type* can't be registered
mid-session, inline its full canonical body into a `general-purpose` agent instead (identical body).

**TDD must be real, not claimed.** Verify from each builder's transcript that the
`superpowers:test-driven-development` skill was invoked and that tests went RED → GREEN (record the
counts, e.g. `7→42`). If a build skipped TDD, **redo that arm** — a non-TDD build is not comparable.

**The verify recipe is per-repo; record it.** For ViewPoint BTW it was: JDK8
(`/usr/lib/jvm/jdk1.8.0_431`), `mvn` 3.9.9, **offline** (`-o`), `-Denforcer.skip=true`, install
`moca.database` first then compile downstream, no Oracle → **DB-free UTs run, ITs compiled-not-run**.
Pre-existing base toolchain gaps (e.g. vp-biz `BASE64DecoderStream`, vp-common-all `ExcelRowProducer`
Record-ambiguity) affect all arms equally — note them; they are not build defects of any arm.

Record per arm in `results/stage-b.md`: `compile` (EXIT code), DB-free UT count, caveats honored
(`n/10`), and the TDD evidence (`skill · RED→GREEN`).

**Stage-B gate (hard #1):** build green (compiles offline; all DB-free UTs pass). An arm that fails is
ineligible regardless of judge scores.

---

## 6. The blind judge panel

1. Export each built arm's diff as `judge/arm-N.diff` and **shuffle** the arm→N mapping. Keep the map
   only with the orchestrator (not the judges).
2. Dispatch **3 independent judges**, each a distinct lens for independence:
   - A — correctness / robustness
   - B — idiom / architecture
   - C — testability / fidelity
   Each judge scores **all 8 rubric dimensions** 0.0–10.0 against the anchors in framework §2a.
3. Composite per arm = Σ(weight × score), reported per-judge and as the panel mean, **with the
   inter-judge spread** (max − min). A dimension with high spread gets re-adjudicated, not silently
   averaged.
4. De-anonymize only after all scores are in.

---

## 7. The verdict — Pareto frontier behind the two gates

Plot **build quality** (panel mean, y) against **Stage-A doc economy** (x). Among arms that pass both
hard gates (build green + caveat-survival 100%), find the Pareto frontier.

- **Primary pick** = the frontier arm with the best quality-per-doc-line that stays within ε = 0.5 of
  the heavy control's quality.
- **Tie-breakers, in order:** caveat-survival margin → review-burden → wall-clock.
- **"Turbo confirmed"** iff a fusion arm reaches quality ≥ (AI-DLC − ε) at planning-lines ≤ 2×
  INFERNO. That is the precise statement of the hypothesis.

Write it up in `results/stage-b.md`: the per-judge table, the headline finding, the Pareto table, and
an explicit economy-vs-quality recommendation. On BTW the frontier was openspec (lowest review
burden) / turbo-a (best code) / aidlc-turbo (best balance, recommended default) — **all three beat
both controls**, and the cheap Stage A had already predicted the two real build bugs.

---

## 8. Optional later stages (only after a winner emerges)

- **TP-4 parallelism:** from each arm's ownership/dependency graph, compute max concurrent builders
  and measure actual wall-clock to green + edit-collision rate.
- **TP-6 generalization:** repeat §1–§7 on a **second** intent (procesbeheer is the obvious one).
  This is the guard against single-intent overfit — do it before adopting any shape into the flow.
- **TP-7 capability-accumulation:** run a *second* change against the same capability. For `openspec`
  it's a small delta vs the merged spec; for the batch arms it's a fresh full bundle. Measures whether
  openspec's one-time baseline cost amortizes.

---

## 9. Per-intent swap checklist (the TL;DR)

To clone this run onto a new intent, change **only** these, and nothing else:

- [ ] New intent chosen; **base commit** frozen and recorded.
- [ ] **Frozen normative AC checklist** written (flow-neutral).
- [ ] `facts/<intent>.yaml` authored (one entry per distinct load-bearing fact).
- [ ] `caveats.yaml` authored (real traps + synthetic plants, with `detect:` keys).
- [ ] 7 arm doc sets generated under `arms/` (write-once, link-don't-restate).
- [ ] Per-repo **build/verify recipe** recorded for Stage B.
- [ ] Hold constant: the builder body, the rubric + weights, the funnel, the two hard gates, the
      blind 3-judge protocol.

If you touched anything in the "hold constant" line, you started a *new* experiment — not a replay.
