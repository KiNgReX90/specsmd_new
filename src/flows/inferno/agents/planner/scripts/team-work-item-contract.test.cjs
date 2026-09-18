const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  validateWorkItem,
} = require("../../orchestrator/skills/orchestrate/scripts/team-scheduler.cjs");

const templatePath = path.resolve(__dirname, "../templates/work-item.md.hbs");
const agentPath = path.resolve(__dirname, "../agent.md");

test("planner body tells the planner to list the tests the change reaches", () => {
  const agent = fs.readFileSync(agentPath, "utf8");
  const template = fs.readFileSync(templatePath, "utf8");

  assert.match(agent, /blast-radius grep/);
  assert.match(agent, /git grep -n/);
  const manifest = template.split("## Execution Manifest")[1].split("## Technical Notes")[0];
  assert.doesNotMatch(manifest, /^#/m, "the manifest carries no comment lines; the rule lives in the planner body");
});

test("planner body carries the blast radius rule and the per-surface test count", () => {
  const agent = fs.readFileSync(agentPath, "utf8");

  assert.match(agent, /\*\*Blast radius is measured\.\*\*/);
  assert.match(agent, /one test per surface/);
});

test("work item template exposes the execution contract", () => {
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

test("work item contract accepts overlapping ownership", () => {
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

test("work item contract rejects missing required context", () => {
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
