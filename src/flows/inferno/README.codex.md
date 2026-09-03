# INFERNO on Codex

Codex support is isolated from the Claude host surface. The two hosts share
intent artifacts, state, canonical templates, scheduler helpers, and
state-transition scripts; they do not share model configuration or host
instructions.

## Invoke the flow

- `$specsmd-inferno`: select, execute, or resume one planned intent.
- `$specsmd-inferno-planner`: capture or repair an intent and its work items.
- `$specsmd-inferno-config`: create, review, or update Codex execution settings.
- `$specsmd-inferno-builder`: the internal worker procedure; the orchestrator
  dispatches it with a complete assignment.

Intent selection and configuration confirmation stay in the parent
conversation. Builders never choose work or spawn nested agents.

## Host files

- `AGENTS.md`: the consuming project's Codex instructions. The installer may
  add the INFERNO activation appendix without replacing project guidance.
- `.agents/skills/specsmd-inferno*/`: Codex-native workflow adapters.
- `.codex/agents/*.toml`: exact custom-agent model and reasoning settings.
- `.specs-inferno/config.codex.yaml`: Codex autonomy, role routing,
  verification, and delivery settings, created through the first-run config
  skill.
- `.specs-inferno/config.yaml` and `.claude/**`: Claude-only host settings and
  adapters.

## Codex model matrix

| Role | Model | Reasoning |
|---|---|---|
| Orchestrator | `gpt-5.6-sol` | `xhigh` |
| Planner | `gpt-5.6-sol` | `xhigh` |
| Strong builder | `gpt-5.6-sol` | `xhigh` |
| Config helper | `gpt-5.6-terra` | `high` |
| Cheap builder | `gpt-5.6-terra` | `high` |

Custom agents inherit the parent session's sandbox and approval policy. Model
and reasoning values in `.codex/agents/*.toml` take precedence for their
spawned roles.
