const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { codexHome } = require("./review-fixture.cjs");

const RUN = path.join(__dirname, "run.cjs");

// The wiring check: a work item that consumes a command, table or event is refused at the
// frontier unless an item of its intent provides it or the host registry names it.

function state(provider) {
  return `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: in_progress
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: p-cmd
        title: "Provider"
        kind: behavior
        complexity: low
        status: ${provider}
        integrated_sha: abc1234
        review: clean
        depends_on: []
      - id: c-screen
        title: "Consumer"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
`;
}

function item(id, wiring) {
  return `---
id: ${id}
title: "${id}"
intent: alpha
kind: behavior
complexity: low
status: pending
depends_on: []
---

# Work Item: ${id}

## Description

The save button calls the backend.

## Execution Manifest

context:
  required:
    - path: src/save.ts
      reason: target
  patterns:
    - path: src/save.ts
      reason: pattern
  tests:
    - path: src/save.test.ts
      reason: test
ownership:
  editable:
    - src/${id}.ts
${wiring}
## Technical Notes

(none)
`;
}

const PROVIDES = "provides:\n  - kind: command\n    name: save_dossier\n";
const CONSUMES = "consumes:\n  - kind: command\n    name: save_dossier\n    seam: e2e/save.spec.ts\n";
const WIRING = `wiring:
  command:
    file: src-tauri/src/commands/mod.rs
    within: 'generate_handler!\\[([\\s\\S]*?)\\]'
    name: '(?:\\w+::)*(\\w+)'
`;
const MOD_RS = "fn run() {\n  tauri::generate_handler![\n    commands::dossier::save_dossier,\n    open_project,\n  ];\n}\n";

function fixture({ provider = "pending", provides = "", config, codex, modRs = MOD_RS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-wiring-"));
  const root = path.join(dir, "app");
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, "utf8");
  };
  write("src/save.ts", "export const save = 1;\n");
  write("src/save.test.ts", "save;\n");
  write("src-tauri/src/commands/mod.rs", modRs);
  write(".specs-inferno/state.yaml", state(provider));
  write(".specs-inferno/intents/alpha/work-items/p-cmd.md", item("p-cmd", provides));
  write(".specs-inferno/intents/alpha/work-items/c-screen.md", item("c-screen", CONSUMES));
  if (config !== undefined) write(".specs-inferno/config.yaml", config);
  if (codex !== undefined) write(".specs-inferno/config.codex.yaml", codex);
  return { dir, root };
}

function frontier(tree, extra = []) {
  const result = spawnSync(process.execPath, [RUN, "frontier", "alpha", "--tree", tree.root, ...extra], {
    cwd: tree.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: path.join(tree.dir, "cache"), CODEX_HOME: codexHome(path.join(tree.dir, "cache")) },
  });
  return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}` };
}

const REFUSED =
  /INVALID c-screen: consumes command save_dossier: no item in alpha provides it and src-tauri\/src\/commands\/mod\.rs does not register it\. /;

test("a consumed command nobody provides and the host does not register refuses the frontier", () => {
  const modRs = "#[tauri::command]\npub fn save_dossier() {}\ntauri::generate_handler![open_project];\n";
  const result = frontier(fixture({ config: WIRING, modRs }));
  assert.equal(result.code, 2);
  assert.match(result.out, REFUSED);
  assert.match(result.out, /Add it to the provides of the item that builds it, or register it in that file/);
});

test("a consumed kind with no registry configured names the config block to add", () => {
  const result = frontier(fixture({}));
  assert.equal(result.code, 2);
  assert.match(result.out, /consumes command save_dossier: no item in alpha provides it and no wiring\.command file is configured to register it\. /);
});

test("an open item of the intent that provides the command counts", () => {
  const result = frontier(fixture({ provides: PROVIDES }));
  assert.doesNotMatch(result.out, /INVALID/);
  assert.match(result.out, /ready c-screen/);
});

test("a completed item that provides the command counts", () => {
  const result = frontier(fixture({ provider: "completed", provides: PROVIDES }));
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /ready c-screen/);
});

test("a command the host registers counts", () => {
  const result = frontier(fixture({ config: WIRING }));
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /ready c-screen/);
});

test("a --config file inherits the registry from config.yaml", () => {
  const tree = fixture({ config: WIRING, codex: "host: codex\n" });
  const result = frontier(tree, ["--config", ".specs-inferno/config.codex.yaml"]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /ready c-screen/);
});

test("a wiring block whose pattern does not compile is refused with its fix", () => {
  const bad = "wiring:\n  command:\n    file: src-tauri/src/commands/mod.rs\n    within: 'generate_handler!\\[('\n    name: '(\\w+)'\n";
  const result = frontier(fixture({ config: bad }));
  assert.equal(result.code, 2);
  assert.match(result.out, /wiring\.command\.within in .*config\.yaml is not a valid regular expression/);
});

test("a wiring block for an unknown kind is refused with its fix", () => {
  const result = frontier(fixture({ config: "wiring:\n  query:\n    file: a.rs\n    within: 'x'\n    name: 'y'\n" }));
  assert.equal(result.code, 2);
  assert.match(result.out, /wiring\.query in .*config\.yaml: the kind must be command, table or event/);
});

test("a registry file that does not exist refuses with the path to fix", () => {
  const tree = fixture({ config: WIRING });
  fs.rmSync(path.join(tree.root, "src-tauri/src/commands/mod.rs"));
  const result = frontier(tree);
  assert.equal(result.code, 2);
  assert.match(result.out, /wiring\.command\.file src-tauri\/src\/commands\/mod\.rs does not exist/);
});

test("a provider of another kind does not wire the consumed command", () => {
  const result = frontier(fixture({ provides: "provides:\n  - kind: table\n    name: save_dossier\n" }));
  assert.equal(result.code, 2);
  assert.match(result.out, /INVALID c-screen: consumes command save_dossier: no item in alpha provides it/);
});

test("a bad wiring block inherited from config.yaml is refused against config.yaml", () => {
  const bad = "wiring:\n  command:\n    file: src-tauri/src/commands/mod.rs\n    within: 'x('\n    name: '(\\w+)'\n";
  const tree = fixture({ config: bad, codex: "host: codex\n" });
  const result = frontier(tree, ["--config", ".specs-inferno/config.codex.yaml"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /wiring\.command\.within in \S*\.specs-inferno\/config\.yaml is not a valid regular expression/);
});
