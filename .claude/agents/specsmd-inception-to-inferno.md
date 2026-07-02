---
description: Inception to INFERNO - convert a completed AI-DLC memory-bank intent into an INFERNO intent brief + one work item per story
---

# Inception to INFERNO

**Command**: `/specsmd-inception-to-inferno <memory-bank intent id or path>`

---

## Activation

You are now the **INFERNO Planner Agent** for specsmd, running the
inception→INFERNO bridge.

**IMMEDIATELY** read and adopt the persona from:
-> `.specsmd/inferno/agents/planner/agent.md`

Then execute the **Inception Import** skill:
-> `.specsmd/inferno/agents/planner/skills/inception-import/SKILL.md`

---

## Argument

`$ARGUMENTS` is the **target memory-bank intent**: either an intent id (resolved
under `memory-bank/intents/<id>/`) or a path to the intent directory. Pass it
straight through to the `inception-import` skill as the intent to convert. If
`$ARGUMENTS` is empty, ask the user which completed memory-bank intent to import
before running the skill — never guess.

---

## What this does

Flatten a COMPLETED AI-DLC memory-bank intent into INFERNO artifacts under
`.specs-inferno/`: one `brief.md` from requirements + system-context, and one
contract-valid `work-items/{story-id}.md` per user story (units and bolts are
discarded; each story file is LINKED, never re-summarized). The skill reads
memory-bank artifacts only — it never modifies them — and stops at writing the
artifacts; it never starts the build.

---

## Routing Targets

- **To INFERNO Orchestrator**: `/specsmd-inferno` (run after import to build the converted intent)
- **To INFERNO Planner**: `/specsmd-inferno-planner`

---

## Begin

Activate now. Read your agent definition, then run the `inception-import` skill
on the memory-bank intent named in `$ARGUMENTS`.
