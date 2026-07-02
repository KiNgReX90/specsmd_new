# Skill: Decisions & Gates

---

## Progress Display

Show at start of this skill:

```text
### Inception Progress
- [x] Intent created
- [x] Requirements gathered
- [ ] Decisions & gates captured  ← current
- [ ] Units + Stories
- [ ] Ready for Construction
```

---

## Checkpoints in This Skill

None of its own — runs as part of the auto-continue batch after requirements approval.
The captured ledger is reviewed together with units and stories at Checkpoint 3.

---

## Goal

Capture, ONCE, the load-bearing reasoning the build will turn on — open questions/caveats,
dated decisions, and release gates — in a single `decisions-and-gates.md` ledger. This is
the lean replacement for the dropped ceremony documents (system-context, impact-analysis,
inception-log): instead of restating the same fact across many files, AI-DLC Turbo writes
it once here and links to it from the stories and from construction.

---

## Input

- **Required**: Intent name or path, and the approved `{intent}/requirements.md`
- **Required**: `.specsmd/aidlc-turbo/memory-bank.yaml` - artifact schema
- **Required**: Read access to the codebase, to ground decisions and surface real caveats
- **Required**: The boundary/integration answers from the requirements deep-dive round
  (Checkpoint 1b) — inside/outside the system, external dependencies, integration contracts
- **Optional**: Existing `{intent}/decisions-and-gates.md` to extend

---

## Process

1. **Read requirements + investigate.** Read `{intent}/requirements.md` and inspect the
   code the build will touch (real files/columns/APIs, existing patterns, house idioms).
   Confirm or contradict what requirements assert.

2. **Record the system boundary & integrations as ledger entries.** AI-DLC Turbo has no
   separate system-context document — the boundary reasoning the full pipeline used to
   capture lives here, as answers to explicit questions rather than a new artifact. Building
   on the deep-dive answers (Checkpoint 1b), ask and record each answer as a decision,
   caveat, or gate:
   - **Inside vs. outside the system** — what does this build own, and what is explicitly
     out of scope? → record the boundary as a dated **decision** (with rationale); record
     each out-of-scope assumption as a **caveat** with a build rule.
   - **External dependencies** — which third-party services, systems, or teams does this
     rely on? → record each as a **caveat** (what to assume / NOT assume about it) or a
     **gate** (must be reachable/contracted before ship).
   - **Integration contracts** — for each boundary crossing, what data flows in/out, in
     which direction, under what contract (schema, protocol, delivery/ordering guarantees)?
     → record the contract as a **decision**; record any unverified contract as an `OPEN`
     caveat with a conservative rule.
   NEVER promote these answers into a `system-context.md` or any new document type — they
   are ledger inputs only.

3. **Surface load-bearing caveats.** A caveat is any fact that, if dropped or guessed,
   causes a real defect — a phantom column, a wrong rounding mode, a forward-only rule
   applied backward. Capture each with an id (`C-1`, `OQ-012`), a status
   (`OPEN` | `resolved`), and an explicit **build rule** stating what to do or what NOT to
   assume. A caveat with no build rule is useless — always give the rule. NEVER silently
   resolve a question the evidence does not settle: record it `OPEN` with a conservative
   rule.

4. **Record dated decisions.** Each: the choice, a one-line rationale (cite the code/file
   when the code is leading), and status (`decided` | `OPEN`).

5. **Record release gates.** The hard conditions that must hold before the intent can ship
   (parity checks, idiom/lint gates, "big-bang, no feature flag", etc.).

6. **Write the ledger** from `templates/inception/decisions-and-gates-template.md` to
   `{intent}/decisions-and-gates.md`. Extend (never overwrite) an existing ledger.

---

## Output

- `{intent}/decisions-and-gates.md` — the single source for decisions, caveats, and gates.
  Stories reference it (link, don't restate); construction reads it before each unit.

---

## Transition

Auto-continue to **units** (lean — minimal grouping stubs), then **stories**, then
**review**. No confirmation prompt between these; only the Checkpoint 3 artifacts review
stops for the user.

---

## Test Contract

- Produces exactly one `{intent}/decisions-and-gates.md`.
- The system-boundary & integration answers (inside/outside, external dependencies,
  integration contracts) are recorded as ledger entries — never as a separate document.
- Every caveat row has an id, a status, and a non-empty build rule.
- Open questions the evidence does not settle are marked `OPEN`, never silently resolved.
