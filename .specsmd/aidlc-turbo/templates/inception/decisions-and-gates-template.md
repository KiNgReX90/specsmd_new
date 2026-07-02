---
intent: {NNN}-{intent-name}
status: inception
created: {ISO-8601}
last_updated: {ISO-8601}
---

# Decisions & Gates — {intent-name}

Single fusion ledger: open questions/caveats, key decisions, release gates. FR/NFR + scope
live in [requirements.md](requirements.md); build detail lives in the per-story files. Each
load-bearing fact is stated **once here** and referenced elsewhere — never restated.

## Open questions & caveats (must be honored at build time)

Load-bearing facts. The build rule states exactly what to do, or what NOT to assume.

| ID | Status | Build rule (what to do / what NOT to assume) |
|----|--------|----------------------------------------------|
| OQ-001 | OPEN | {e.g. "no DB column exists for X — do NOT add a NOT NULL column; treat as transient until a data specialist confirms"} |
| C-1 | resolved | {the rule the builder must follow} |

## Key decisions (dated)

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| {YYYY-MM-DD} | {the choice} | {one line; cite the code/file when the code is leading} | decided |

## Release gates

Hard conditions that must hold before this intent can ship.

- {e.g. parity gate: refactored output matches the baseline on the test environment}
- {e.g. idiom/lint gate: no house-convention violations}
- {e.g. big-bang release, no feature flag}
