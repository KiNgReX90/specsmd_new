const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

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
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A throwaway project tree, committed so `git grep` can see it, or without git at all. */
function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-frontier-"));
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

// --- ownership closure ---------------------------------------------------
test("frontier names a test file that references an owned export", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(
    result.out,
    /candidate a-tile src\/board\/tile\.test\.ts references src\/board\/tile\.ts via renderTile/,
  );
});

test("frontier leaves a hit inside the item's own ownership alone", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /candidate a-panel/);
});

test("frontier names the open item that owns a candidate hit", () => {
  const tree = fixture();
  const payload = JSON.parse(run(tree, ["frontier", "alpha", "--json"]).out);
  const hit = payload.candidates.find((entry) => entry.path === "scripts/check-tiles.mjs");
  assert.ok(hit, "the script that references the owned export is a candidate");
  assert.equal(hit.ownedBy, "a-scripts");
  assert.match(
    run(tree, ["frontier", "alpha"]).out,
    /candidate a-tile scripts\/check-tiles\.mjs owned-by a-scripts via renderTile/,
  );
});

test("frontier outside a git repository prints no candidate and stays green", () => {
  const tree = fixture({ git: false });
  const result = run(tree, ["frontier", "alpha", "--tree", tree.root]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /candidate/);
});

test("an owned test file lends its name to nothing", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /candidate a-dash/);
});

test("a basename counts as a reference only where it names a module", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /e2e\/board\.spec\.ts/);
});

test("a symbol counts as a reference only as a whole word", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /e2e\/board-wide\.spec\.ts/);
});

test("a key that hits half the suite is skipped as generic evidence", () => {
  const tree = fixture();
  const out = run(tree, ["frontier", "gamma"]).out;
  assert.match(out, /skipped g-generic evaluate \(7 hits\)/);
  assert.doesNotMatch(out, /candidate g-generic/);
});

test("candidates stop at ten lines for one item and count the rest", () => {
  const tree = fixture();
  const out = run(tree, ["frontier", "gamma"]).out;
  const named = out.split("\n").filter((line) => line.startsWith("candidate g-wide "));
  assert.equal(named.length, 10);
  assert.match(out, /candidates g-wide and 2 more/);
});

test("a serialize line always precedes the candidates the cap trims", () => {
  const tree = fixture();
  const printed = run(tree, ["frontier", "gamma"]).out.split("\n");
  const serialize = printed.findIndex((line) => line.startsWith("serialize "));
  const candidate = printed.findIndex((line) => line.startsWith("candidate "));
  assert.ok(serialize >= 0, "the shared ownership is still reported");
  assert.ok(candidate > serialize, "candidates come after the serialize lines");
});

// --- probes --------------------------------------------------------------
test("probes stay green while every measurement still holds", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "b-ok"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /probe ok b-ok grep -c radius src\/board\/tile\.css/);
  assert.match(result.out, /probe ok b-ok test -f src\/board\/tile\.ts/);
});

test("probes report a count the tree has moved past", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "b-drift", "--intent", "beta"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /drift b-drift grep -c radius src\/board\/tile\.css expected 9 got 2/);
  const payload = JSON.parse(run(tree, ["probes", "b-drift", "--json"]).out);
  assert.equal(payload.ok, false);
  assert.equal(payload.probes[0].got, "2");
});

test("probes treat a command that fails as drift", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "b-fail"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /drift b-fail cat src\/board\/nope\.css expected 8 got exit 1/);
});

// An item that corrects nothing measures nothing: `probes:` stays optional. The corrective
// items below are the ones that owe evidence, and the cases after this one prove it.
test("an item that corrects nothing needs no measurement", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "a-panel"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /no probes a-panel/);
});

// --- diagnosis evidence on a corrective item -----------------------------
// One item of 2026-09-09 named a pixel cause it had never measured (the dials in
// board-fit.css) while the real cause was a hundred pixels of shelf foot. A corrective ui or
// behavior item now carries the claim, the probe that shows it, and what the probe printed,
// and the frontier replays the probe on the dispatch tree before anything is dispatched.

test("a corrective item with no diagnosis block blocks its dispatch", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "delta"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /INVALID d-missing: .*diagnosis/);
});

test("a diagnosis whose probe no longer prints what it showed blocks its dispatch", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "epsilon"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /INVALID e-stale: diagnosis probe .* expected 9 got 2/);
});

test("a diagnosis whose probe fails blocks its dispatch", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "epsilon"]);
  assert.match(result.out, /INVALID e-fails: diagnosis probe .* got exit 1/);
});

test("a corrective item whose evidence still holds is dispatchable", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "theta"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /ready t-fresh/);
  assert.match(result.out, /ready t-clean/);
});

test("probes replays the diagnosis beside the item's own measurements", () => {
  const tree = fixture();
  assert.match(run(tree, ["probes", "t-fresh"]).out, /diagnosis ok t-fresh/);
  assert.equal(run(tree, ["probes", "e-stale"]).code, 2);
});

test("frontier refuses a probe that carries no command", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "beta"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /INVALID b-bad: probes\[0\]\.run/);
});
