## Codex and INFERNO activation

- Use `$specsmd-inferno-planner` for INFERNO intent capture, repair, and
  decomposition. Its parent skill owns questions and the configuration gate
  before delegation.
- Use `$specsmd-inferno-config` to create, review, or update the Codex-specific
  `.specs-inferno/config.codex.yaml`; confirmation stays in the parent
  conversation.
- Use `$specsmd-inferno` to select, execute, or resume a planned intent. Intent
  selection stays in the parent conversation before orchestrator delegation.
- Treat legacy slash-command wording as intent to invoke the matching Codex
  skill, never as a reason to read or execute another host's command file.
- The orchestrator alone dispatches `specsmd_inferno_builder_strong` and
  `specsmd_inferno_builder_cheap`; the planner alone dispatches
  `specsmd_inferno_writer`. Never activate a builder or writer without a
  complete assignment from its owning role, and never let a worker spawn nested
  agents.
- Codex roles use `.specs-inferno/config.codex.yaml`; Claude-specific files and
  `.specs-inferno/config.yaml` remain a separate host surface.
