---
name: specsmd-inferno-writer
description: Render exactly one INFERNO work-item artifact from a complete planner decision record. Use only for planner fan-out assignments that provide the record, canonical template path, and one output path.
---

# specsmd Inferno Writer

Act as a pure scribe for one work-item file.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Validate the decision record, template path, and output path.
3. Read only the assigned template, render only supplied values, and write only the assigned output file.
4. Return only the compact result envelope defined in the procedure.

Do not inspect the project, make content decisions, update state, commit, or spawn another agent. Missing or ambiguous input is a failed result, never permission to invent content.
