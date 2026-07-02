# Verdict — BTW-stamgegevens: INFERNO (real builders) vs AI-DLC

**Date:** 2026-06-24
**Eval arm:** A2 (inception → INFERNO bridge, parallel build) — **rerun with the real flow**
**Feature:** BTW-stamgegevens beheerpagina + VAT VP-source refactor (ViewPoint)
**Base (both builds):** AI-DLC bolt-002 SQL foundation (`6e1259fb7cf`) — unit-001 views/columns reused, not rebuilt.

---

## What changed vs the first A2 attempt

The first attempt dispatched **generic agents** with ad-hoc prompts — no TDD, not the canonical builder
persona. That invalidated the comparison. This rerun uses the **actual INFERNO flow**:

- **Planner side:** the 10 work items were validated against the real `team-scheduler.cjs`
  `validateWorkItem` contract (all pass). The inception→INFERNO bridge's extraction core was run; it
  surfaced a real gap (see "Findings", item 6).
- **Builder side:** every work item was built by a subagent running the **canonical
  `specsmd-inferno-builder` definition as its system prompt**, including the mandatory TDD gate
  ("invoke `superpowers:test-driven-development` before the first implementation edit"). TDD was
  genuinely enforced this time — every code item has a DB-free test written test-first.
- **Orchestration:** dependency-frontier dispatch — unit-002 (VAT) and unit-003 (DomUI) ran as two
  **parallel disjoint tracks**; items within each track serialized on shared ownership (see the
  companion note on converter granularity).

> Note: the canonical builder could not be registered as a live subagent **type** mid-session (the
> agent registry loads at session start), so it was run as the builder **body inlined** as the
> agent's system prompt. Functionally identical — the TDD gate and builder contract were in force —
> but worth recording for reproducibility.

**Build footprint (real-builder):** 19 production files + 11 test files (8 UT suites = 48 DB-free
tests, + 3 DB-backed ITs) + 2 docs = **32 files, +3,143 / −29 lines**. Full feature compiles under
JDK8; all 48 DB-free unit tests green. ITs not run (no Oracle reachable in this environment).
Pushed: `inferno-test/btw-stamgegevens-real-builders`.

---

## 3-judge panel result

Independent judges, distinct lenses, each read both real git trees. Scores 1–5 (5 best).

| Dimension          | INFERNO (real) | AI-DLC | Winner   |
|--------------------|:--------------:|:------:|----------|
| Correctness        | 4              | 4      | tie      |
| Robustness         | 4              | 5      | AI-DLC   |
| OQ-012 handling    | 4              | 5      | AI-DLC   |
| House-idiom fit    | 3              | 4      | AI-DLC   |
| Architecture       | 4              | 4      | tie      |
| Maintainability    | 3              | 4      | AI-DLC   |
| Testability        | 5              | 2      | **INFERNO** |
| Spec fidelity      | 5              | 3      | **INFERNO** |

**Overall panel vote: 2–1 for AI-DLC** (correctness+OQ-012 judge → AI-DLC; idiom+architecture judge
→ AI-DLC; testability+fidelity judge → INFERNO).

**This is close, and the split is the real story — not the headline.**

---

## The decisive caveat: the two builds did NOT build the same scope

AI-DLC **reinterpreted** the spec during inception (decisions H-1/H-2/RD-4/D-3): it concluded BTW
codes are *sync-led*, so it **descoped ~half the feature** — no create-from-page, no tarief-entry
from the page, a **generic unconditional delete veto** instead of the systeemcode/geblokkeerd guards,
and it **dropped the "type" concept entirely**. The result is smaller, cleaner, internally airtight
code — but it does **not deliver** atomic code+tarief creation, tarief auto-close, or the
differentiated delete guards the work-item ACs ask for.

INFERNO built the spec **literally and in full**: atomic code+first-tarief insert in one transaction,
auto-close of the previous open tarief (`ingangsdatum − 1`), re-read-before-delete race protection,
the full add/edit/block/delete/filter surface. So INFERNO's "fidelity 5 vs 3" and AI-DLC's
"maintainability/robustness edge" are partly **two sides of the same coin**: AI-DLC wins on
cleanliness because it chose to build less.

That difference is a **product decision** (is BTW beheer sync-led or VP-led?), not a pure code-quality
gap. A fair reading: **on equal scope, the builds are roughly even**, with INFERNO clearly ahead on
test safety net and AI-DLC ahead on idiom polish and concurrency hardening.

---

## Findings (file:line-grounded, from the panel)

1. **Phantom-schema defect FIXED (the headline improvement over the first attempt).** The earlier
   generic build mapped a non-existent `BTW_TYPE` / `BTW_VOORGEDEFINIEERD_YN` column as
   `nullable=false` on the core table — which would break **every** insert at runtime. All three
   judges confirmed the real-builder build maps **no phantom column**: `VatCode.isVoorgedefinieerd()`
   is a `@Transient` accessor with no backing `@Column`, the "type" UI is a disabled "nog niet
   beschikbaar" field, the type filter is inert, the overview renders "–". OQ-012 handled honestly.
2. **Real correctness gap (INFERNO):** `VATDetails.details()` (`VATDetails.java:109`) still queries
   the **raw** `bae_btw_tarieven` with `max(startdatum) <= peildatum` and **no einddatum cap**, while
   `VAT.prepareQuery` was correctly moved to the views. AI-DLC refactored **both** read paths to the
   views with `nvl(effectieve_einddatum, 9999)`. This is a genuine bug the no-DB verification could
   not catch — it needs the einddatum-aware resolution on both paths.
3. **Idiom violation (INFERNO):** 41 non-ASCII lines in comments **and a non-ASCII en-dash string
   literal in production** (`BtwCodeOverzichtFormat.java:24`) — violates ViewPoint's ASCII-only-code
   rule. AI-DLC: 0 non-ASCII. Trivially lint-fixable, but a real house-idiom miss.
4. **Layering smell (INFERNO):** load-bearing Dutch user strings (button labels, full
   error/confirmation sentences) hardcoded in the `moca.database` persistence layer
   (`BtwBlokkeerActie`, `BtwVerwijderActie`) instead of a `.properties` bundle. AI-DLC routes page
   text through the bundle (with minor inline leaks).
5. **Concurrency hardening (AI-DLC edge):** `DaoVatCode.saveGeblokkeerd` does `refresh()`-before-save
   to dodge the known `BAE_BTW_BRIU` optimistic-lock `ORA-20000` during concurrent sync. INFERNO
   re-reads before delete and before the block toggle, but **not** on the add/edit save path.
6. **Bridge extraction gap (planner side):** the inception-import extractor only recognizes the
   English heading `## Acceptance Criteria`; the unit-002/003 stories use Dutch `## Acceptatiecriteria`,
   so the raw extractor returns **empty** acceptance criteria for exactly the stories built here. The
   work items used here carried the AC correctly (linked story files + carried-over criteria), but
   the extractor should be taught the Dutch heading. (Filed as a flow follow-up.)
7. **Testability (decisive INFERNO win):** INFERNO extracted the load-bearing rules into DB-free
   helper classes that are both unit-tested in isolation **and** wired into the transactional DAO
   path — 48 meaningful DB-free assertions (auto-close date math, chronology/overlap, delete-guard
   ordering + NL messages, 3-state filter via real QCriteria-tree inspection, decade-free VAT SQL,
   VATCalculator delegation reflection-guard). AI-DLC has only ~5 DB-free tests; nearly all its
   verification lives in IT suites that cannot run without Oracle.

---

## Thesis read-out (doc-bloat vs flatten-to-parallel-items)

The original hypothesis: *AI-DLC's doc-bloat can be replaced by flattening inception output directly
into parallel INFERNO work items without losing build correctness/quality.*

**Supported, with qualifications.** The real-builder INFERNO build, driven only by flattened
work-items (story files linked, no unit/bolt prose), produced a **fully-spec'd, compiling,
heavily-unit-tested** implementation that is competitive with the doc-heavy AI-DLC serial build — and
**more faithful to the written ACs**. The doc-bloat was **not required** for build correctness.

But the head-to-head exposed three things the flow should add to reach parity on the dimensions
INFERNO lost:

- **An idiom/lint gate** (ASCII-only, no-hardcoded-strings) — a real builder still drifts here; a
  cheap `finalize_check` would have caught finding #3/#4.
- **DB-in-CI (or a contract test) for the resolution layer** — the einddatum-cap bug (#2) is exactly
  the class of defect a no-DB run hides.
- **Finer work-item decomposition for genuine parallelism** — see the companion note
  `inferno-converter-granularity-idea.md`. The 1:1 story→item conversion gave only 2-wide
  parallelism here (the two unit tracks); the six unit-003 stories serialized on shared ownership.

Net: **flatten-to-items is viable and the real builders (with TDD) materially beat the earlier
generic run** — most importantly by eliminating the phantom-column defect. The remaining gap to
AI-DLC is polish (idiom, optimistic-lock, one resolution bug) and a scope-interpretation difference,
not a structural failure of the bridge.
