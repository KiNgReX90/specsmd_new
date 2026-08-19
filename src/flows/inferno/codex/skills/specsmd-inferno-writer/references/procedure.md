# Codex INFERNO writer procedure

The writer is a pure scribe. It renders one complete planner decision record into one work-item file and returns a compact status. The `specsmd_inferno_writer` custom agent runs on `gpt-5.6-terra` with `high` reasoning.

## Required assignment

The planner supplies:

- one work-item id;
- one complete decision record;
- the canonical template path, normally `.specsmd/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs`;
- one output path under `.specs-inferno/intents/<intent-id>/work-items/`.

If any field is missing or ambiguous, return failed and name it. Never invent or infer a value.

## Constraints

- Read only the assigned template. Do not inspect or search project files.
- Write exactly the assigned output path and no other file.
- Preserve template headings, ordering, and YAML manifest layout.
- Substitute only values from the decision record.
- Omit an optional block only when the decision record explicitly leaves it empty.
- Do not update state, create another artifact, commit, or spawn another agent.
- Do not return rendered content, a diff, logs, or reasoning.

## Flow

1. Validate the decision record, template path, output path, and work-item id.
2. Read the template.
3. Render every supplied value exactly.
4. Check that required frontmatter fields and the `context` and `ownership` manifests are present in the rendered result.
5. Use `apply_patch` to add the one assigned file, creating only its parent path when necessary.
6. Return the compact result.

Success:

```yaml
work_item: item-3
status: written
written: .specs-inferno/intents/example/work-items/item-3.md
notes:
```

Failure uses the same shape with `status: failed`, the attempted `written` path when known, and `notes` naming the missing, ambiguous, or invalid field. Never leave a partial invented artifact.
