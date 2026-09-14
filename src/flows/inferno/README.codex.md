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

## Workers are the session's own subagents

Every INFERNO role on Codex runs as a `spawn_agent` subagent of the session that
dispatches it, with `fork_turns: "none"`. That covers the orchestrator, the
planner, the config helper, every builder, the oracle and the tester. None of
them is a separate Codex process, an Orca worktree, an Orca terminal, an
`orca orchestration` dispatch or a job driven through the `orchestration` or
`orca-cli` skill. A subagent inherits this session's approval policy and
sandbox. A separate process prompts by its own configuration instead. A
subagent in an on-request session can still surface a fresh approval. The
`agent_type` parameter selects the role and takes the `name` from the matching
file in `.codex/agents/`. The `task_name` parameter never selects a role. A
builder is dispatched with `agent_type: "specsmd_inferno_builder_strong"` or
`agent_type: "specsmd_inferno_builder_cheap"`, each with `fork_turns: "none"`.
The session holds four concurrent thread slots and the primary thread is one of
them, so a dispatch round starts at most three workers and the orchestrator
keeps the rest of the frontier for the next round. `wait_agent` wakes on any
mailbox activity, a message or a completion, so one return never proves every
worker finished. Track each outstanding worker by id and call `wait_agent`
again until every worker the round dispatched has returned. Continue a warm
worker with `followup_task` for a correction. The one intent worktree is a
plain `git worktree`.

Run the Codex finalize gate with `node
.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs gate
--config .specs-inferno/config.codex.yaml`. The config path is relative to the
selected worktree. The option applies to `integrate`, `gate`, `gate --detach`,
`gate --wait`, `green` and `ship`. Without it, the runner reads `.specs-inferno/config.yaml`.
Each command reuses its last successful result while its scope is unchanged.
Proofs from different config files remain separate.

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
