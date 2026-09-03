# Codex INFERNO configuration procedure

Configure only `.specs-inferno/config.codex.yaml`. The parent conversation owns display and confirmation; the delegated `specsmd_inferno_config` custom agent applies the approved change on `gpt-5.6-terra` with `high` reasoning.

## Schema

All keys are optional except that a created file should include the fixed Codex role matrix.

```yaml
autonomy:
  level: review

roles:
  orchestrator:
    agent: specsmd_inferno_orchestrator
    model: gpt-5.6-sol
    reasoning_effort: xhigh
  planner:
    agent: specsmd_inferno_planner
    model: gpt-5.6-sol
    reasoning_effort: xhigh
  builder_strong:
    agent: specsmd_inferno_builder_strong
    model: gpt-5.6-sol
    reasoning_effort: xhigh
  config:
    agent: specsmd_inferno_config
    model: gpt-5.6-terra
    reasoning_effort: high
  builder_cheap:
    agent: specsmd_inferno_builder_cheap
    model: gpt-5.6-terra
    reasoning_effort: high
  writer:
    agent: specsmd_inferno_writer
    model: gpt-5.6-terra
    reasoning_effort: high

verification:
  finalize:
    - <ordered shell command>

delivery:
  mode: auto-close
  base_branch: <confirmed branch>

halt:
  flag_file: <optional path>
  wait_script: <optional path>

knowledge:
  index: <optional path>
```

Allowed values:

- `autonomy.level`: `review` or `full`. Accepted for compatibility; the planner never pauses either way.
- `delivery.mode`: `auto-close` or `merge-request`.
- `verification.finalize`: ordered non-empty command strings when present.
- `delivery.base_branch`: a real branch confirmed by the user.
- halt paths and knowledge index: project-relative paths when present.

The role names, custom agent names, models, and reasoning efforts above are fixed compatibility values. Do not silently substitute aliases or downgrade a role.

## Parent-thread review

1. Read applicable `AGENTS.md` instructions and the current Codex config if it exists.
2. If absent, discover likely production build and full-test commands from project manifests and discover the repository default branch. Treat discoveries as proposals, not confirmed choices.
3. Display effective settings in plain language:
   - the six fixed role assignments;
   - ordered final verification commands;
   - delivery mode and proposed base branch;
   - optional halt and knowledge integrations.
4. Ask one compact confirmation question. If the user requests changes, show the revised effective values and confirm them. Keep this interaction in the parent conversation.
5. After confirmation, spawn `specsmd_inferno_config` with an exact approved value map, repository root, target path, and this procedure path. Do not delegate an unresolved choice.

## Delegated write

1. Read the target file when it exists.
2. Validate the approved values against the schema and verify any configured path or command source that can be checked without running a heavy build.
3. Preserve unknown top-level and nested keys, comments, and existing settings the user did not change.
4. Use a focused `apply_patch`; do not rewrite the entire file when a local edit is sufficient.
5. Write no file other than `.specs-inferno/config.codex.yaml`.
6. Parse the result using the project's available YAML parser or configuration consumer. Also confirm with `rg` that every fixed role contains the exact `agent`, `model`, and `reasoning_effort` values.
7. Return:

```yaml
status: configured
path: .specs-inferno/config.codex.yaml
validated: true
notes:
```

On invalid input or parse failure, return `status: failed`, `validated: false`, and a bounded error in `notes`. Do not leave a knowingly invalid partial configuration.

## First-run gate

The planner invokes this skill before planning when the Codex config is absent. The orchestrator invokes it before execution when absent. After configuration succeeds, return control to the original parent flow; configuration itself never captures, plans, or builds an intent.
