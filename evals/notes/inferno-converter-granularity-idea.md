# Idea — finer-grained inception→INFERNO conversion for real parallelism

**Date:** 2026-06-24
**Status:** forward-looking experiment (deliberately deferred — "maybe after this")
**Origin:** Ruben's observation during the BTW A2 rerun.

---

## The observation

INFERNO's advantage over AI-DLC's serial flow is that it runs **small work items in parallel across
many builder subagents** — that's where the speed comes from. The current inception→INFERNO bridge
(`agents/planner/skills/inception-import`) does a **1:1 flatten: one user story → one work item**.
That's faithful and contract-valid, but it may leave INFERNO's parallelism on the table: the items
are exactly as coarse as the inception stories were.

The question Ruben raised: *would a converter that chops stories/bolts into smaller pieces — so they
execute and test more quickly in parallel — beat the straight 1:1 translation?*

## Firsthand evidence from this run (it's real, not hypothetical)

The BTW build had **10 work items in 2 units**. Actual parallelism was only **2-wide**, not 10-wide:

- **unit-002 (VAT refactor)** and **unit-003 (DomUI beheerpagina)** ran as two genuinely parallel,
  disjoint tracks. Good.
- But the **six unit-003 stories serialized** — overzicht → toevoegen → wijzigen → blokkeren →
  delete → filter, one after another — even though four of them depend only on the overview.

**Why they serialized:** the bridge assigns `ownership.editable` as the **unit's directory
partition**. Every unit-003 story therefore owned the *same* paths (`pages/bae/btwcodes/`,
`moca.database/.../db/bae/`, `VpRight.java`). The orchestrator's `selectDispatchableItems` correctly
refuses to dispatch items with overlapping `ownership.editable` concurrently (it prevents edit
collisions), so they queued. Coarse ownership → forced serialization → INFERNO's parallelism
collapses toward serial within a unit.

So the 1:1 conversion didn't just keep items "story-sized" — it produced **overlapping ownership**
that actively *prevented* the parallel execution that is INFERNO's whole point.

## Why naive chopping isn't enough

You can't just split each page into its own file-ownership and call it parallel: the unit-003 stories
genuinely **share** surfaces — they all touch the overview page (toevoegen wires `onNew`, blokkeren
adds a toggle column, filter adds the query manipulator, delete adds a row action) and they all share
`DaoVatCode` and `VatCode`. Hand them disjoint file-ownership and they'll **collide** on those shared
files instead.

The real lever is **dependency-aware decomposition**, not just smaller items:

1. **Extract the shared surface into a foundation item** that the leaves depend on — e.g. an
   "overview shell + DaoVatCode skeleton + entity mapping" item. Once it's committed, the
   leaf features can own *disjoint* additions.
2. **Give leaves disjoint ownership** — each leaf owns its own page/helper file (`BtwCodeToevoegenPage`
   + its validator, `BtwOverzichtFilter`, `BtwVerwijderActie`, …) and depends on the foundation. With
   the shared surface already in place, the leaves no longer overlap and **fan out in parallel**.
3. **Or** keep coarse ownership but split each story into independently-testable sub-items (pure
   logic helper vs page wiring), so at least the DB-free logic pieces parallelize and test fast.

This run accidentally demonstrated the upside of (1)+(2): the builders *already* extracted small
DB-free helpers (`BtwCodeToevoegenValidatie`, `BtwTariefToevoegenValidatie`, `BtwBlokkeerActie`,
`BtwVerwijderActie`, `BtwOverzichtFilter`, `BtwCodeOverzichtFormat`). Those are exactly the seams a
finer converter could have made into **separate, parallel, fast-to-test work items**.

## Proposed experiment (when we get to it)

Add a **"chop" mode** to the inception-import / decompose skill that, per story:

- Splits into sub-items along natural seams: **(a) pure logic/validation** (DB-free, own file, own
  UT), **(b) persistence** (DAO method), **(c) UI wiring** (page).
- Computes a **finer ownership + dependency graph**: shared surfaces become a front-loaded foundation
  item; leaves get disjoint file-level ownership and `depends_on` the foundation.
- Emits items that still pass `validateWorkItem` (required/editable/patterns/tests).

**Measure** against the 1:1 baseline on the same intent:

- wall-clock to green (this run: 2-wide → ~6 serial rounds for unit-003);
- builder count actually running concurrently (target: ≥4-wide for a 6-story unit);
- edit-collision / `blocked` rate (must stay ~0 — the whole point of disjoint ownership);
- final code/test quality (must not regress vs the verdict note).

**Hypothesis:** finer, dependency-ordered chopping turns the unit-003 chain from ~6 serial rounds into
1 foundation round + 1 parallel leaf round, materially cutting wall-clock without raising the
collision rate — i.e. it buys back the parallelism the 1:1 conversion left on the table.

## Caution

Finer is not free: more items = more orchestration overhead, more dependency edges to get right, and a
higher chance of a bad split causing collisions or a broken foundation that blocks every leaf. The
experiment should gate on the collision/blocked rate, and the "chop" mode should stay **opt-in** until
it demonstrably beats 1:1 on wall-clock *without* hurting quality.
