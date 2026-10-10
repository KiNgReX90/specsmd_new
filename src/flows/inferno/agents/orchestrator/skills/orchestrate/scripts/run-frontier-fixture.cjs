/**
 * Shared fixture for the run.cjs frontier and probes suites: a throwaway project tree, committed
 * so `git grep` can see it, and a `run` that drives the CLI as a process.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

const RUN = path.join(__dirname, "run.cjs");

const STATE = `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: a-tile
        title: "A tile"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: a-panel
        title: "A panel"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: a-scripts
        title: "A script"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: a-dash
        title: "A dashboard test"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
  - id: beta
    title: "Beta"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: b-ok
        title: "B ok"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: b-drift
        title: "B drift"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: b-fail
        title: "B fail"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: b-bad
        title: "B bad"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
  - id: gamma
    title: "Gamma"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: g-generic
        title: "G generic"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: g-wide
        title: "G wide"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: g-share
        title: "G share"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
  - id: delta
    title: "Delta"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: d-missing
        title: "D missing"
        kind: ui
        complexity: low
        status: pending
        depends_on: []
  - id: epsilon
    title: "Epsilon"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: e-stale
        title: "E stale"
        kind: ui
        complexity: low
        status: pending
        depends_on: []
      - id: e-fails
        title: "E fails"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
  - id: theta
    title: "Theta"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: t-fresh
        title: "T fresh"
        kind: ui
        complexity: low
        status: pending
        depends_on: []
      - id: t-clean
        title: "T clean"
        kind: ui
        complexity: low
        status: pending
        depends_on: []
  - id: iota
    title: "Iota"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: i-alias
        title: "I alias"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
  - id: zeta
    title: "Zeta"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: z-dir
        title: "Z folder"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: z-file
        title: "Z file"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
`;

/** A tree shaped like a host project: an owned module, its test, a script that checks it. */
const SOURCES = {
  "src/board/tile.ts": 'export function renderTile(width) {\n  return width;\n}\n',
  "src/board/tile.test.ts": 'import { renderTile } from "./tile";\n\nrenderTile(4);\n',
  "src/board/tile.css": ".tile {\n  border-radius: 8px;\n}\n.tile-open {\n  border-radius: 4px;\n}\n",
  "src/panel/panel.ts": 'export const panelHeading = "Documents";\n',
  "src/panel/panel.test.ts": 'import { panelHeading } from "./panel";\n\npanelHeading;\n',
  "scripts/check-tiles.mjs": "// renderTile stays exported for the board\n",
  "src/dash/dashboard.test.ts": 'import { open } from "./open";\n\nopen("dashboard");\n',
  "e2e/dashboard.spec.ts": 'test("the dashboard opens", async () => {});\n',
  "e2e/board.spec.ts": 'test("the tile stays visible", async () => {});\n',
  "e2e/board-wide.spec.ts": "renderTiles();\n",
  "src/wide/generic.ts": "export function evaluate(value) {\n  return value;\n}\n",
  "src/wide/wide.ts": "export function wideAlpha() {\n  return 1;\n}\n\nexport function wideBeta() {\n  return 2;\n}\n",
};

// Seven specs call the same common identifier, and six call each narrow symbol.
for (let i = 1; i <= 7; i += 1) SOURCES[`e2e/generic-${i}.spec.ts`] = "evaluate(4);\n";
for (let i = 1; i <= 6; i += 1) {
  SOURCES[`e2e/wide-a${i}.spec.ts`] = "wideAlpha();\n";
  SOURCES[`e2e/wide-b${i}.spec.ts`] = "wideBeta();\n";
}

/** Render one work-item spec the way the planner's template does. */
function item(spec) {
  const rows = (entries) =>
    entries.map((entry) => `    - path: ${entry}\n      reason: why ${entry}`).join("\n");
  const probeRows = (entries) =>
    `probes:\n${entries
      .map((entry) => `    - run: "${entry.run}"\n      shows: "${entry.shows}"`)
      .join("\n")}\n`;

  const diagnosis = spec.diagnosis
    ? `diagnosis:\n  claim: "${spec.diagnosis.claim}"\n  probe: "${spec.diagnosis.probe}"\n  shows: "${spec.diagnosis.shows}"\n`
    : "";

  return `---
id: ${spec.id}
title: "${spec.id}"
intent: ${spec.intent}
kind: ${spec.kind || "behavior"}
complexity: low
status: pending
depends_on: []
---

# Work Item: ${spec.id}

## Description

${spec.description || "One tile gains a second row of cards at 960px."}

## Execution Manifest

context:
  required:
${rows(spec.required || ["src/board/tile.ts"])}
  patterns:
${rows(spec.patterns || ["src/board/tile.ts"])}
  tests:
${rows(spec.tests || ["src/board/tile.test.ts"])}
ownership:
  editable:
${spec.editable.map((entry) => `    - ${entry}`).join("\n")}
${spec.probes ? probeRows(spec.probes) : ""}${diagnosis}
## Technical Notes

(none)
`;
}

const ITEMS = {
  "alpha/a-tile": item({ id: "a-tile", intent: "alpha", editable: ["src/board/tile.ts"] }),
  "alpha/a-panel": item({
    id: "a-panel",
    intent: "alpha",
    editable: ["src/panel/panel.ts", "src/panel/panel.test.ts"],
  }),
  "alpha/a-scripts": item({ id: "a-scripts", intent: "alpha", editable: ["scripts/check-tiles.mjs"] }),
  "alpha/a-dash": item({ id: "a-dash", intent: "alpha", editable: ["src/dash/dashboard.test.ts"] }),
  "gamma/g-generic": item({ id: "g-generic", intent: "gamma", editable: ["src/wide/generic.ts"] }),
  "gamma/g-wide": item({ id: "g-wide", intent: "gamma", editable: ["src/wide/wide.ts"] }),
  "gamma/g-share": item({ id: "g-share", intent: "gamma", editable: ["src/wide/wide.ts"] }),
  "beta/b-ok": item({
    id: "b-ok",
    intent: "beta",
    editable: ["src/board/tile.css"],
    probes: [
      { run: "grep -c radius src/board/tile.css", shows: "2" },
      { run: "test -f src/board/tile.ts && echo yes", shows: "yes" },
    ],
  }),
  "beta/b-drift": item({
    id: "b-drift",
    intent: "beta",
    editable: ["src/board/tile.css"],
    probes: [{ run: "grep -c radius src/board/tile.css", shows: "9" }],
  }),
  "beta/b-fail": item({
    id: "b-fail",
    intent: "beta",
    editable: ["src/board/tile.css"],
    probes: [{ run: "cat src/board/nope.css", shows: "8" }],
  }),
  "beta/b-bad": item({
    id: "b-bad",
    intent: "beta",
    editable: ["src/board/tile.css"],
    probes: [{ run: "", shows: "4" }],
  }),
  // A corrective item: it exists because something on the screen is wrong today.
  "delta/d-missing": item({
    id: "d-missing",
    intent: "delta",
    kind: "ui",
    description: "The tile row is broken below 960px, so the last card falls off the board.",
    editable: ["src/board/tile.css"],
  }),
  "epsilon/e-stale": item({
    id: "e-stale",
    intent: "epsilon",
    kind: "ui",
    description: "The board is broken at 960px because the shelf foot is too tall.",
    editable: ["src/board/tile.css"],
    diagnosis: { claim: "the shelf foot adds 104 px", probe: "grep -c radius src/board/tile.css", shows: "9" },
  }),
  "epsilon/e-fails": item({
    id: "e-fails",
    intent: "epsilon",
    description: "A regression: the tile no longer renders its width.",
    editable: ["src/board/tile.ts"],
    diagnosis: { claim: "the width is dropped", probe: "cat src/board/nope.css", shows: "2" },
  }),
  "iota/i-alias": item({ id: "i-alias", intent: "iota", editable: ["src/board/tile.ts", "alias/"] }),
  "zeta/z-dir": item({ id: "z-dir", intent: "zeta", editable: ["src/board/"] }),
  "zeta/z-file": item({ id: "z-file", intent: "zeta", editable: ["./src/board/tile.css"] }),
  "theta/t-fresh": item({
    id: "t-fresh",
    intent: "theta",
    kind: "ui",
    description: "The board is broken at 960px because the shelf foot is too tall.",
    editable: ["src/board/tile.css"],
    diagnosis: { claim: "two radii carry the tile", probe: "grep -c radius src/board/tile.css", shows: "2" },
  }),
  "theta/t-clean": item({
    id: "t-clean",
    intent: "theta",
    kind: "ui",
    description: "The shelf gains a second row of cards at 960px.",
    editable: ["src/panel/panel.ts"],
  }),
};

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFile(path.join(root, rel), body, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A throwaway project tree, committed so `git grep` can see it, or without git at all. */
function fixture(options = {}) {
  const dir = tempDir("inferno-frontier-");
  const root = path.join(dir, "app");
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, body] of Object.entries(SOURCES)) write(root, rel, body);
  write(root, ".specs-inferno/state.yaml", STATE);
  for (const [key, body] of Object.entries(ITEMS)) {
    const [intent, id] = key.split("/");
    write(root, `.specs-inferno/intents/${intent}/work-items/${id}.md`, body);
  }
  if (options.git !== false) {
    git(root, ["init", "-q", "-b", "main", "."]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "init"]);
  }
  return { dir, root };
}

function run(fixtureTree, args) {
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: fixtureTree.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: path.join(fixtureTree.dir, "cache") },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

module.exports = { fixture, run };
