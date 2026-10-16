# Session memory: a task-scoped LLM wiki for long agent work

Status: design discussion, nothing built. Written 2026-10-16 from a Claude Code session (Claude Opus 5.5), with an independent review by GPT-6 Astra at reasoning effort max. Work on it continues on this branch.

## The problem

Claude Code and Codex sessions that run for days lose detail at every compaction. The summary keeps the gist and drops the specifics: exact pids, commit shas, the user's literal words with their time, running processes, decisions with their reasons, and above all which responsibilities the agent had taken on. The suspicion that started this design: a long live-testing run went badly partly because the orchestrating agent forgot, after compactions, what it was supposed to watch.

The idea is an LLM wiki in the style of Karpathy's pattern (an index, short pages, a log) that an agent writes its progress into and searches back through, so it carries a long-term memory of the work instead of carrying everything in context.

## What was measured

All numbers come from the longest session on the user's machine: one Claude Code session of 19 days.

- **Compactions.** 102, all triggered manually, at a median of 248k tokens (max 580k) on a model with a 1M window.
- **Summaries.** Each one averages 2,635 words and summarises the previous summary again. A detail from the first week has passed through up to 100 rounds of re-summarising.
- **The transcript is lossless.** The JSONL transcript (338 MB) still holds every message and tool result. Compaction drops nothing from the file.
- **The user's own words** over those 19 days: about 605 messages and 11,400 words. They fit in a small page.
- **The fixed stack.** The first turn of a session costs about 57k input tokens (system prompt, tools, skills, instruction files). The user's own always-loaded instruction files were 6,763 words. One field-notes file was 4,045 words against its own cap of 2,200.

## What the evidence says about the cause

Astra found the most important correction. The compaction summary written on day 6 still recorded that the batch watcher had hit its time limit and had not been restarted. That fact survived compaction. The agent chose not to restart it. Other notes from the same run describe checks that tested whether a process was alive instead of whether its output reached the next stage.

So compaction loss is not proven to be the main cause. A memory system would also have faithfully stored the wrong arrangement. Memory solves part of the problem, and the checks themselves must test the right thing.

## Design

### A pot per task, attached by name

Memory belongs to a task, not to a session. A long-running task gets a "pot" (as in a slow cooker) with a fixed id and a name. Nothing loads by default. The user tells a session "attach to pot X", and from then on that session reads and writes that pot. A freshly spawned agent can be pointed at the same pot and pick up the running work.

The attachment is stored outside the model's context, so a resume or a compaction restores it automatically.

### Who writes what

- **A script extracts the facts** from the transcript: the user's literal messages with timestamps, commits, background tasks, spawned agents, pids with machine and start time. A script does this without errors and costs no tokens per turn. It deduplicates on the source record id.
- **Each compaction summary becomes its own page.** A summary is written while its segment is fully in context, so it is the best record of decisions and reasons for that stretch. Kept as a first-generation page, it is never summarised again.
- **The model writes only what no script can see:** a responsibility when it takes one on, a decision with its reason and source, and the explicit close or withdrawal of either. An open obligation never disappears through summarising.

### State goes stale

Pids and running processes are rebuilt and checked at every injection (is this pid still alive, on which machine). An old pid proves nothing about the present. A dead pid in memory is worse than none.

### Responsibilities are executable checks

This is the page that pays most, and only if each responsibility is a check that can run, never a sentence. Each watch task names its check, interval, expected progress, response time and escalation. A sentence in a log is as easy to forget as a sentence in a summary.

A check runs on an **independent timer outside the agent**, so it keeps running through a compaction and while the agent has no turn. It wakes the owner and escalates an unanswered alarm. A watcher that disappears is itself an alarm. A check asks whether the output reaches the next stage, never only whether a process lives.

### Who reads when

- `SessionStart` with source `compact` or `resume` injects the pot's index, the current responsibilities and the fresh state: a few hundred words.
- The session reads every other page on demand. The index says per page when to open it.
- `PreCompact` processes whatever backlog the script has not seen. `PostCompact` records the transition.

This gives the pot a fixed reader at the exact moment memory loss happens, which is what keeps it from becoming a file nobody reads.

### One owner per pot

Read access is not ownership. Each responsibility has exactly one owner, with an explicit hand-over. A take-over gets a new version, so a previous owner cannot write stale changes. Without this, two agents attached to one pot steer the same lanes.

## Storage and access

- **Start local.** Markdown pages generated from SQLite outside git, with the transcripts as the source. The pages stay readable and greppable.
- **A small CLI before anything else** (`pot attach`, `pot read`, `pot log`). The agent calls it through the shell. It costs no context until used and works the same for Claude and Codex. MCP is a possible adapter later; with tool search the context cost depends on configuration, but a CLI is cheaper still.
- **Centralise later.** Agents run on several machines, which is the one real argument for a central store. The same CLI can later talk to an API with unique event ids, version checks and local buffering when the network is down. No new central ownership claim without a connection.
- **No graph database yet.** A database of every conversation is the transcript again in another shape. A graph built by a model costs tokens and holds errors nobody sees. Consider it only for a concrete question that plain tables cannot answer.
- **Sensitive data keeps its boundary.** Pots from a project that holds personal or financial identifiers stay on the user's own machine, or are encrypted with keys the central host never receives. A shared host owned by someone else gets non-sensitive metadata only, with access per project. Search indexes, logs and backups respect the same boundary.

## The fixed stack, done on 2026-10-16

The other half of context pressure is what every session loads before it reads anything. The field-notes file was retired. Its general lessons became one-line rules in the global instruction file, and its orchestration lessons moved into the orchestration skill, which loads only when orchestrating. The character file was cut from 1,690 to 698 words. The user's always-loaded instruction text went from 6,763 to 2,163 words.

## A weakness found on the way

The existing budget `Stop` hook lets a session stop as soon as a `HANDOFF.md` exists, whatever it contains. A read receipt alone would have the same weakness. Any hook in this design checks content, never only existence.

## Smallest proof

One pot, one watch task, one model adapter and one independent timer, local only.

1. Replay a recorded stall (a lane that stopped making progress for hours) and a broken hand-off between stages.
2. Force ten compactions and one session switch.
3. Run the same scenario without the pot.

Success means zero lost obligations, exact retrieval of the user's words, times and shas, one owner per task, and detection within two check intervals. Also measure false alarms, extra tokens and waiting time. Centralise only after the same proof passes with Codex and with a network outage.

## Open questions

- Who triggers the manual compactions at around 250k tokens, and why there on a 1M window? Compacting later means fewer rounds of re-summarising, at the cost of a longer context.
- Where does the CLI live: in specsmd as part of the flow, or as a standalone harness tool that any project can use?
