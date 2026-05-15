# Specsmd Fire Team Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `specsmd-fire-team-planner` workflow that behaves like the standard FIRE planner but emits team-compatible work items for `/specsmd-fire-team`.

**Architecture:** Keep the existing planner untouched. Create a parallel command, Codex skill, Claude agent wrapper, and `.specsmd/fire/agents/team-planner` tree that mirrors the normal planner while enriching decomposition output with `depends_on`, `context`, and `ownership` fields. Reuse the team scheduler validator in tests so planner output and team execution agree on the manifest contract.

**Tech Stack:** Markdown skills/commands, Handlebars-style templates, Node.js built-in test runner.

---

### Task 1: Planner Contract Tests

**Files:**
- Create: `.specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs`
- Read: `.specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.cjs`
- Read: `.specsmd/fire/agents/team-planner/skills/work-item-decompose/templates/work-item.md.hbs`

- [ ] **Step 1: Write the failing contract test**

Create `.specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  validateWorkItem,
} = require("../../../../team/skills/orchestrate/scripts/team-scheduler.cjs");

const templatePath = path.resolve(__dirname, "../templates/work-item.md.hbs");

test("team work item template exposes the team execution contract", () => {
  const template = fs.readFileSync(templatePath, "utf8");

  for (const token of [
    "depends_on:",
    "kind:",
    "context:",
    "required:",
    "patterns:",
    "tests:",
    "ownership:",
    "editable:",
  ]) {
    assert.match(template, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("team work item contract accepts overlapping ownership", () => {
  const first = {
    id: "item-1",
    kind: "behavior",
    context: {
      required: [{ path: "src/feature.js", reason: "primary implementation" }],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: {
      editable: ["src/feature.js"],
    },
  };
  const second = {
    id: "item-2",
    kind: "behavior",
    context: {
      required: [{ path: "src/feature.js", reason: "shared implementation" }],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: {
      editable: ["src/feature.js"],
    },
  };

  assert.equal(validateWorkItem(first).valid, true);
  assert.equal(validateWorkItem(second).valid, true);
});

test("team work item contract rejects missing required context", () => {
  const invalid = {
    id: "item-3",
    kind: "behavior",
    context: {
      required: [],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: {
      editable: ["src/feature.js"],
    },
  };

  assert.deepEqual(validateWorkItem(invalid), {
    valid: false,
    errors: ["item-3: context.required must contain at least one path"],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test .specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs
```

Expected: FAIL with `ENOENT` because the team-planner template does not exist yet.

### Task 2: Activation Layer

**Files:**
- Create: `.codex/skills/specsmd-fire-team-planner/SKILL.md`
- Create: `.claude/commands/specsmd-fire-team-planner.md`
- Create: `.claude/agents/specsmd-fire-team-planner.md`

- [ ] **Step 1: Add the Codex skill**

Create `.codex/skills/specsmd-fire-team-planner/SKILL.md`:

```markdown
---
name: specsmd-fire-team-planner
description: "FIRE Team Planner Agent - captures intents and decomposes into team-compatible work items"
---

# Activate FIRE Team Planner

**Command**: `/specsmd-fire-team-planner`

---

## Activation

You are now the **FIRE Team Planner Agent** for specsmd.

**IMMEDIATELY** read and adopt the persona from:
-> `.specsmd/fire/agents/team-planner/agent.md`

---

## Critical First Steps

1. **Read Config**: `.specsmd/fire/memory-bank.yaml`
2. **Read State**: `.specs-fire/state.yaml`
3. **Determine Mode**:
   - No active intent -> `intent-capture` skill
   - Intent without work items -> `work-item-decompose` skill
   - High-complexity work item -> `design-doc-generate` skill
   - Ready team-compatible work items -> route to `/specsmd-fire-team`

---

## Your Skills

- **Intent Capture**: `.specsmd/fire/agents/team-planner/skills/intent-capture/SKILL.md` -> Capture new intent
- **Work Item Decompose**: `.specsmd/fire/agents/team-planner/skills/work-item-decompose/SKILL.md` -> Break into team-compatible work items
- **Design Doc Generate**: `.specsmd/fire/agents/team-planner/skills/design-doc-generate/SKILL.md` -> Create design doc

---

## Routing Targets

- **Back to Orchestrator**: `/specsmd-fire`
- **To Team Orchestrator**: `/specsmd-fire-team`

---

## Begin

Activate now. Read your agent definition and start planning.
```

- [ ] **Step 2: Add the Claude command**

Create `.claude/commands/specsmd-fire-team-planner.md` with the same activation body as the Codex skill, using this frontmatter:

```yaml
---
description: FIRE Team Planner Agent - captures intents and decomposes into team-compatible work items
---
```

- [ ] **Step 3: Add the Claude agent wrapper**

Create `.claude/agents/specsmd-fire-team-planner.md` with the same activation body and frontmatter as `.claude/commands/specsmd-fire-team-planner.md`.

### Task 3: Team Planner Agent And Skills

**Files:**
- Create: `.specsmd/fire/agents/team-planner/agent.md`
- Create: `.specsmd/fire/agents/team-planner/skills/intent-capture/SKILL.md`
- Create: `.specsmd/fire/agents/team-planner/skills/intent-capture/templates/brief.md.hbs`
- Create: `.specsmd/fire/agents/team-planner/skills/design-doc-generate/SKILL.md`
- Create: `.specsmd/fire/agents/team-planner/skills/design-doc-generate/templates/design.md.hbs`
- Create: `.specsmd/fire/agents/team-planner/skills/work-item-decompose/SKILL.md`
- Create: `.specsmd/fire/agents/team-planner/skills/work-item-decompose/templates/work-item.md.hbs`

- [ ] **Step 1: Add the team planner persona**

Create `.specsmd/fire/agents/team-planner/agent.md` by mirroring `.specsmd/fire/agents/planner/agent.md` with these intentional differences:

```markdown
---
name: fire-team-planner-agent
description: Intent architect and team work item designer for FIRE. Captures user intent and decomposes into manifests suitable for parallel team execution.
version: 1.0.0
---
```

The agent body must keep the same planner lifecycle and add these constraints:

```xml
<constraint>EVERY work item MUST include depends_on, context.required, and ownership.editable</constraint>
<constraint>Work items that change behavior, architecture, UI, or APIs MUST include context.patterns</constraint>
<constraint>Work items MUST include context.tests unless they are docs-only or config-only</constraint>
<constraint>Overlapping ownership is allowed; the team orchestrator decides what can run in parallel</constraint>
```

The handoff must route ready work items to `/specsmd-fire-team`.

- [ ] **Step 2: Copy unchanged intent capture assets**

Copy the normal planner intent-capture skill and template into:

```text
.specsmd/fire/agents/team-planner/skills/intent-capture/SKILL.md
.specsmd/fire/agents/team-planner/skills/intent-capture/templates/brief.md.hbs
```

Change only references needed to keep follow-up decomposition inside `team-planner/skills/work-item-decompose/SKILL.md`.

- [ ] **Step 3: Copy design doc assets with team wording**

Copy the normal planner design-doc skill and template into:

```text
.specsmd/fire/agents/team-planner/skills/design-doc-generate/SKILL.md
.specsmd/fire/agents/team-planner/skills/design-doc-generate/templates/design.md.hbs
```

Add one design skill instruction: if design decisions affect execution slicing, document the affected `context` and `ownership` assumptions so work-item decomposition can preserve them.

- [ ] **Step 4: Add team decomposition skill**

Create `.specsmd/fire/agents/team-planner/skills/work-item-decompose/SKILL.md` by adapting the normal decomposition skill. Keep the normal complexity and autonomy-bias behavior, and require each saved item to include:

```yaml
kind: behavior | architecture | api | ui | test | docs-only | config-only
depends_on: []
context:
  required:
    - path: path/to/file
      reason: why the builder starts here
  patterns:
    - path: path/to/file
      reason: pattern to follow
  tests:
    - path: path/to/test
      reason: verification target
ownership:
  editable:
    - path/to/file-or-directory
```

Add explicit wording that overlap is allowed and must not be artificially avoided by the planner.

- [ ] **Step 5: Add team work item template**

Create `.specsmd/fire/agents/team-planner/skills/work-item-decompose/templates/work-item.md.hbs` with the standard work item fields plus the team fields:

```markdown
---
id: {{id}}
title: {{title}}
intent: {{intent}}
kind: {{kind}}
complexity: {{complexity}}
mode: {{mode}}
status: {{status}}
depends_on: [{{#each depends_on}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}]
created: {{created}}
---

# Work Item: {{title}}

## Description

{{description}}

## Acceptance Criteria

{{#each acceptance_criteria}}
- [ ] {{this}}
{{/each}}

## Team Execution Manifest

context:
  required:
{{#each context.required}}
    - path: {{this.path}}
      reason: {{this.reason}}
{{/each}}
  patterns:
{{#each context.patterns}}
    - path: {{this.path}}
      reason: {{this.reason}}
{{/each}}
  tests:
{{#each context.tests}}
    - path: {{this.path}}
      reason: {{this.reason}}
{{/each}}
ownership:
  editable:
{{#each ownership.editable}}
    - {{this}}
{{/each}}

## Technical Notes

{{#if technical_notes}}
{{technical_notes}}
{{else}}
(none)
{{/if}}

## Dependencies

{{#if depends_on}}
{{#each depends_on}}
- {{this}}
{{/each}}
{{else}}
(none)
{{/if}}
```

### Task 4: Verification And Commit

**Files:**
- Test: `.specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs`
- Read-only guard: existing planner files

- [ ] **Step 1: Run the new planner contract tests**

Run:

```bash
node --test .specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs
```

Expected: PASS.

- [ ] **Step 2: Run the existing team scheduler tests**

Run:

```bash
node --test .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs
```

Expected: PASS.

- [ ] **Step 3: Verify existing planner files were not changed**

Run:

```bash
git diff --name-only HEAD -- .codex/skills/specsmd-fire-planner .claude/commands/specsmd-fire-planner.md .claude/agents/specsmd-fire-planner.md .specsmd/fire/agents/planner
```

Expected: no output.

- [ ] **Step 4: Run whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add .codex/skills/specsmd-fire-team-planner .claude/commands/specsmd-fire-team-planner.md .claude/agents/specsmd-fire-team-planner.md .specsmd/fire/agents/team-planner docs/superpowers/plans/2026-05-15-specsmd-fire-team-planner.md docs/superpowers/specs/2026-05-15-specsmd-fire-team-planner-design.md
git commit -m "Add specsmd fire team planner"
git push origin main
```

Expected: commit succeeds and push updates `origin/main`.
