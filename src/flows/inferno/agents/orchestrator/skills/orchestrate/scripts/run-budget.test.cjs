const assert = require("node:assert/strict");
const test = require("node:test");
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
      - id: a-one
        title: "A one"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
`;

const CONFIG = `delivery:
  mode: auto-close
  base_branch: main
`;

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFile(path.join(root, rel), body, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A one-intent host repo with the given config files; no machine budget is in reach. */
function repo(files = {}) {
  const dir = tempDir("inferno-budget-");
  const root = path.join(dir, "app");
  git(dir, ["init", "-q", "-b", "main", root]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  write(root, ".specs-inferno/state.yaml", STATE);
  write(root, ".specs-inferno/config.yaml", CONFIG);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  return { dir, root };
}

function claim(fixture, args = [], env = {}) {
  const result = spawnSync(process.execPath, [RUN, "claim", "alpha", ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_CACHE_HOME: path.join(fixture.dir, "cache"),
      XDG_DATA_HOME: path.join(fixture.dir, "data"),
      INFERNO_FLOW_BUDGET: "",
      ...env,
    },
  });
  return { code: result.status, out: (result.stdout || "") + (result.stderr || ""), err: result.stderr || "" };
}

function claimed(fixture) {
  return /claim intent/.test(git(fixture.root, ["log", "-1", "--pretty=%s"]));
}

function refusingStub(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFile(file, `print(${JSON.stringify(line)})\nraise SystemExit(1)\n`);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The config names the script first, so a host whose script sits elsewhere is still checked,
// and a configured script that is gone is a refusal, never a silent pass.
test("claim runs the budget script config budget.script names, with ~ expanded", () => {
  const fixture = repo({ ".specs-inferno/config.yaml": `${CONFIG}budget:\n  script: ~/tools/budget.py\n` });
  refusingStub(path.join(fixture.dir, "tools", "budget.py"), "OVER configured budget");
  const result = claim(fixture, [], { HOME: fixture.dir });
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /OVER configured budget/);
  assert.equal(claimed(fixture), false);
});

test("claim refuses when the configured budget script is missing", () => {
  const fixture = repo({ ".specs-inferno/config.yaml": `${CONFIG}budget:\n  script: /nowhere/flow-text-budget.py\n` });
  const result = claim(fixture);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /\/nowhere\/flow-text-budget\.py/);
  assert.equal(claimed(fixture), false);
});

test("claim says it skipped the budget when no script sits at the unconfigured default", () => {
  const fixture = repo();
  const result = claim(fixture);
  assert.equal(result.code, 0, result.out);
  const expected = path.join(fixture.dir, "data", "specsmd-inferno", "flow-text-budget.py");
  assert.match(result.err, new RegExp(`SKIP budget \\(no script at ${escape(expected)}\\)`));
});

// A Codex claim selects config.codex.yaml; the budget is a machine fact, so it is read from
// config.yaml exactly as the installer reads it.
test("a claim on the Codex config finds budget.script in config.yaml", () => {
  const stub = "OVER codex claim budget";
  const fixture = repo({
    ".specs-inferno/config.codex.yaml": CONFIG,
  });
  const script = path.join(fixture.dir, "budget.py");
  refusingStub(script, stub);
  write(fixture.root, ".specs-inferno/config.yaml", `${CONFIG}budget:\n  script: ${script}\n`);
  git(fixture.root, ["commit", "-qam", "budget"]);
  const result = claim(fixture, ["--config", ".specs-inferno/config.codex.yaml"]);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, new RegExp(stub));
  assert.equal(claimed(fixture), false);
});

test("claim refuses, naming the script, when the budget interpreter dies on a signal", () => {
  const fixture = repo();
  const script = path.join(fixture.dir, "budget.py");
  writeFile(script, "raise SystemExit(0)\n");
  const bin = path.join(fixture.dir, "bin");
  fs.mkdirSync(bin);
  writeFile(path.join(bin, "python3"), "#!/bin/sh\nkill -9 $$\n", { mode: 0o755 });
  const result = claim(fixture, [], { INFERNO_FLOW_BUDGET: script, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, new RegExp(escape(script)));
  assert.match(result.out, /SIGKILL/);
  assert.equal(claimed(fixture), false);
});
