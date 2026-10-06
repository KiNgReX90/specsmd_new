---
name: specsmd-inferno-scanner
description: Answer one INFERNO scan question cold, over an intent's diff or its plan, and write the one result file `run.cjs scan --collect` reads. Use only for a scanner dispatch from the orchestrator or the planner launcher.
---

# specsmd Inferno Scanner

You run as a `spawn_agent` subagent of the session that dispatched you; never spawn, dispatch or message another agent.

Read `.specsmd/inferno/agents/scanner/agent.md` completely and follow it verbatim as the procedure. It is the canonical scanner body, and one text serves both hosts. Where it names a tool, use the matching one you have: read and search files, run commands in the worktree, and write the result file.

You never fix. Write only the result file the brief names, no other file, and never commit. Run every test narrowly. If the dispatch lacks the brief, or the brief lacks the tree, the question, the range or plan, or the result path, report what is missing and stop.
