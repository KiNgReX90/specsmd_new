const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const RUN = path.join(__dirname, "run.cjs");
const WRITER = path.join(__dirname, "state-transition.cjs");

const STATE = `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: pending
    base_branch: main
    depends_on_intents: [gone-to-archive]
    work_items:
      - id: a-one
        title: "A one"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: a-two
        title: "A two"
        kind: behavior
        complexity: medium
        status: pending
        depends_on: [a-one]
  - id: beta
    title: "Beta"
    status: pending
    depends_on_intents: [alpha]
    work_items:
      - id: b-one
        title: "B one"
        kind: docs-only
        complexity: low
        status: pending
        depends_on: []
  - id: gamma
    title: "Gamma"
    status: in_progress
    claimed_at: 2026-09-01T00:00:00Z
    claimed_by: inferno-intent/gamma-20260901T000000Z
    depends_on_intents: []
    work_items:
      - id: g-one
        title: "G one"
        status: pending
        depends_on: []
`;

const CONFIG = `models:
  strong: model-strong
  cheap: model-cheap
verification:
  finalize:
    - echo always
    - echo scoped
  finalize_scopes:
    "echo scoped": ["docs/**"]
worktree:
  bootstrap:
    - mkdir -p node_modules && echo ran > node_modules/marker
delivery:
  mode: auto-close
  base_branch: main
`;

/** Render one work-item spec the way the planner's template does. */
function item(spec) {
  const rows = (entries) =>
    (entries || []).map((p) => `    - path: ${p}\n      reason: why ${p}`).join("\n");
  return `---
id: ${spec.id}
title: "${spec.id}"
intent: ${spec.intent}
kind: ${spec.kind || "behavior"}
complexity: ${spec.complexity || "low"}
status: pending
depends_on: [${(spec.depends_on || []).join(", ")}]
---

# Work Item: ${spec.id}

## Execution Manifest

context:
  required:
${rows(spec.required || ["src/a.ts"])}
  patterns:
${rows(spec.patterns || ["src/b.ts"])}
  tests:
${rows(spec.tests || ["src/a.test.ts"])}
ownership:
  editable:
${(spec.editable || ["src/a.ts"]).map((p) => `    - ${p}`).join("\n")}
${spec.finalize_check ? `finalize_check: ${spec.finalize_check}\n` : ""}
## Technical Notes

(none)
`;
}

const ITEMS = {
  "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: ["src/a.ts"], finalize_check: "test -f src/a.ts" }),
  "alpha/a-two": item({ id: "a-two", intent: "alpha", complexity: "medium", depends_on: ["a-one"], editable: ["src/b.ts"] }),
  "beta/b-one": item({ id: "b-one", intent: "beta", kind: "docs-only", editable: ["docs/b.md"] }),
  "gamma/g-one": item({ id: "g-one", intent: "gamma", editable: ["src/g.ts"] }),
};

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

/** A throwaway repo shaped like a host project: a bare origin, a ledger, item specs. */
function repo(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-run-"));
  const root = path.join(dir, "app");
  const remote = path.join(dir, "remote.git");
  fs.mkdirSync(root, { recursive: true });
  git(dir, ["init", "--bare", "-q", remote]);
  git(dir, ["init", "-q", "-b", "main", root]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);

  write(root, ".gitignore", "node_modules/\n");
  write(root, "src/a.ts", "export const a = 1;\n");
  write(root, "src/b.ts", "export const b = 2;\n");
  write(root, "src/a.test.ts", "// proof\n");
  write(root, "docs/b.md", "docs\n");
  write(root, ".specs-inferno/state.yaml", options.state || STATE);
  write(root, ".specs-inferno/config.yaml", options.config || CONFIG);
  for (const [key, body] of Object.entries(options.items || ITEMS)) {
    const [intent, id] = key.split("/");
    write(root, `.specs-inferno/intents/${intent}/work-items/${id}.md`, body);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-qu", "origin", "main"]);
  return { dir, root, remote, cache: path.join(dir, "cache") };
}

/** Drive the CLI the way the orchestrator does: a process, an exit code, stdout. */
function run(fixture, args, options = {}) {
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: options.cwd || fixture.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

function lines(out) {
  return out.split("\n").filter((line) => line.length > 0);
}

/** Claim alpha and open its worktree; returns the worktree path and branch. */
function opened(fixture) {
  run(fixture, ["claim", "alpha"]);
  const made = JSON.parse(run(fixture, ["worktree", "alpha", "--json"]).out);
  return { tree: made.path, branch: made.branch };
}

// --- usage ---------------------------------------------------------------
test("an unknown subcommand is a usage error, not a failure", () => {
  const fixture = repo();
  const result = run(fixture, ["frobnicate"]);
  assert.equal(result.code, 1);
});

test("every human subcommand keeps stdout at 30 lines or fewer", () => {
  const fixture = repo();
  for (const args of [["select"], ["frontier", "alpha"]]) {
    assert.ok(lines(run(fixture, args).out).length <= 30, `${args[0]} printed too much`);
  }
});

// --- select --------------------------------------------------------------
test("select offers a pending intent whose prerequisites have shipped", () => {
  const fixture = repo();
  const out = run(fixture, ["select"]).out;
  // `gone-to-archive` answers to nothing in the live ledger, so it is archived, not missing.
  assert.match(out, /alpha/);
  assert.match(out, /1 low, 1 medium/);
});

test("select withholds an intent whose prerequisite intent is still open", () => {
  const fixture = repo();
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.deepEqual(result.claimable.map((entry) => entry.id), ["alpha"]);
  assert.equal(result.blocked[0].id, "beta");
  assert.deepEqual(result.blocked[0].unmet, ["alpha"]);
});

test("select reports a claimed intent with no branch as a recovery candidate", () => {
  const fixture = repo();
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  const recovery = result.recovery.map((entry) => entry.id);
  assert.deepEqual(recovery, ["gamma"]);
  assert.match(result.recovery[0].check, /ledger|DRIFT/);
});

test("select keeps a claimed intent off the recovery list while its worktree is being edited", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 2;\n");
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.deepEqual(result.recovery.map((entry) => entry.id), ["gamma"]);
});

test("select recovers a claimed intent whose worktree has been idle past the window", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const threeHoursAgo = `@${Math.floor(Date.now() / 1000) - 3 * 3600} +0000`;
  git(tree, ["commit", "-q", "--amend", "--no-edit", "--date", threeHoursAgo], {
    GIT_COMMITTER_DATE: threeHoursAgo,
  });
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  const alpha = result.recovery.find((entry) => entry.id === "alpha");
  assert.ok(alpha, "alpha is a recovery candidate");
  assert.match(alpha.reason, /idle for \d+ min/);
  assert.equal(alpha.tree, tree);
});

test("select reads the live ledger only, never the archive", () => {
  const fixture = repo();
  write(fixture.root, ".specs-inferno/archive/state.yaml", "intents:\n  - id: poison\n    status: completed\n");
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.ok(!JSON.stringify(result).includes("poison"));
});

// --- claim / unclaim -----------------------------------------------------
test("claim commits only the ledger while the primary tree is dirty outside it", () => {
  const fixture = repo();
  write(fixture.root, "src/a.ts", "export const a = 99;\n");
  write(fixture.root, "HANDOFF.md", "another session's note\n");
  const result = run(fixture, ["claim", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  const committed = git(fixture.root, ["show", "--name-only", "--pretty=", "HEAD"]).trim().split("\n");
  assert.deepEqual(committed, [".specs-inferno/state.yaml"]);
  assert.match(git(fixture.root, ["status", "--porcelain"]), /src\/a\.ts/);
  assert.match(git(fixture.root, ["status", "--porcelain"]), /HANDOFF\.md/);
});

test("claim commits the claim and prints the sha", () => {
  const fixture = repo();
  // The ledger's own dirt is the run's business and never blocks the claim.
  fs.appendFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "# touched\n");
  const result = run(fixture, ["claim", "alpha", "--json"]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.out);
  assert.match(payload.sha, /^[0-9a-f]{7,40}$/);
  assert.equal(git(fixture.root, ["log", "-1", "--pretty=%s"]).trim(), "specsmd(alpha): claim intent for run");
  assert.match(fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8"), /status: in_progress/);
});

test("claim is idempotent for the run that already holds the intent", () => {
  const fixture = repo();
  const first = JSON.parse(run(fixture, ["claim", "alpha", "--json"]).out);
  const second = run(fixture, ["claim", "alpha", "--run", first.run, "--json"]);
  assert.equal(second.code, 0);
  assert.equal(JSON.parse(second.out).claimed, false);
  assert.equal(git(fixture.root, ["rev-list", "--count", "HEAD"]).trim(), "2");
});

test("claim refuses an intent whose prerequisite intent is open", () => {
  const fixture = repo();
  assert.equal(run(fixture, ["claim", "beta"]).code, 2);
});

test("unclaim gives back a claim nothing was built on", () => {
  const fixture = repo();
  run(fixture, ["claim", "alpha"]);
  const result = run(fixture, ["unclaim", "alpha"]);
  assert.equal(result.code, 0);
  const ledger = fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8");
  assert.match(ledger, /- id: alpha\n {4}title: "Alpha"\n {4}status: pending\n/);
});

test("unclaim refuses once the intent branch carries work", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "work"]);
  const result = run(fixture, ["unclaim", "alpha"]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /commit/);
});

// --- worktree ------------------------------------------------------------
test("worktree opens the branch the claim recorded and runs the bootstrap", () => {
  const fixture = repo();
  run(fixture, ["claim", "alpha", "--run", "inferno-intent/alpha-20260903T000000Z"]);
  const result = run(fixture, ["worktree", "alpha"]);
  assert.equal(result.code, 0);
  assert.match(result.out, /inferno-intent\/alpha-20260903T000000Z/);
  assert.match(result.out, /bootstrap PASS/);
  const made = JSON.parse(run(fixture, ["worktree", "alpha", "--json"]).out);
  assert.equal(fs.readFileSync(path.join(made.path, "node_modules/marker"), "utf8").trim(), "ran");
  assert.equal(git(made.path, ["status", "--porcelain"]).trim(), "");
});

test("worktree hands back the open worktree instead of making a second", () => {
  const fixture = repo();
  const first = opened(fixture);
  const again = JSON.parse(run(fixture, ["worktree", "alpha", "--json"]).out);
  assert.equal(again.path, first.tree);
  assert.equal(again.created, false);
});

// --- frontier ------------------------------------------------------------
test("frontier refuses an item whose manifest is incomplete, naming the field", () => {
  const broken = { ...ITEMS, "alpha/a-two": item({ id: "a-two", intent: "alpha", editable: [], tests: [] }) };
  const fixture = repo({ items: broken });
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /a-two/);
  assert.match(result.out + result.err, /ownership\.editable/);
});

test("frontier refuses a required path that is not on disk", () => {
  const broken = { ...ITEMS, "alpha/a-one": item({ id: "a-one", intent: "alpha", required: ["src/ghost.ts"] }) };
  const fixture = repo({ items: broken });
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /src\/ghost\.ts/);
});

test("frontier prints the ready item with its tier and holds the dependent one", () => {
  const fixture = repo();
  const result = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(result.ready.map((entry) => entry.id), ["a-one"]);
  assert.equal(result.ready[0].tier, "cheap");
  assert.deepEqual(result.waiting.map((entry) => entry.id), ["a-two"]);
});

test("frontier serializes two ready items that share an editable path", () => {
  const shared = {
    "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: ["src/a.ts"] }),
    "alpha/a-two": item({ id: "a-two", intent: "alpha", editable: ["src/a.ts", "src/b.ts"] }),
  };
  const state = STATE.replace("        depends_on: [a-one]", "        depends_on: []");
  const fixture = repo({ items: { ...ITEMS, ...shared }, state });
  const result = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(result.serialize, [{ items: ["a-one", "a-two"], shared: ["src/a.ts"] }]);
  assert.deepEqual(result.dispatch, ["a-one"]);
});

test("frontier suggests one dispatch for consecutive low items of the same tier", () => {
  const batched = {
    "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: ["src/a.ts"] }),
    "alpha/a-two": item({ id: "a-two", intent: "alpha", editable: ["src/b.ts"] }),
  };
  const state = STATE
    .replace("        depends_on: [a-one]", "        depends_on: []")
    .replace("        complexity: medium", "        complexity: low");
  const fixture = repo({ items: { ...ITEMS, ...batched }, state });
  const result = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(result.batch, [["a-one", "a-two"]]);
});

// --- verify-item ---------------------------------------------------------
test("verify-item passes the item's own check and reports ownership clean", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["verify-item", "a-one", "--tree", tree]);
  assert.equal(result.code, 0);
  assert.match(result.out, /PASS/);
});

test("verify-item fails with the log path and the tail of the log", () => {
  const failing = {
    ...ITEMS,
    "alpha/a-one": item({ id: "a-one", intent: "alpha", finalize_check: "echo the reason; exit 1" }),
  };
  const fixture = repo({ items: failing });
  const { tree } = opened(fixture);
  const result = run(fixture, ["verify-item", "a-one", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out, /FAIL/);
  assert.match(result.out, /the reason/);
});

test("verify-item names a changed file outside the item's ownership", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/b.ts", "export const b = 9;\n");
  const result = run(fixture, ["verify-item", "a-one", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out, /src\/b\.ts/);
});

// --- gate / green --------------------------------------------------------
test("gate runs a command with no scope and skips one whose paths did not change", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "work"]);
  const result = run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 0);
  assert.match(result.out, /PASS \d+s echo always/);
  assert.match(result.out, /SKIP echo scoped/);
});

test("gate stops at the first failing command and points at its log", () => {
  const config = CONFIG.replace("    - echo always", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out, /FAIL/);
  assert.match(result.out, /the reason/);
  const log = /-> (\S+)/.exec(result.out)[1];
  assert.match(fs.readFileSync(log, "utf8"), /the reason/);
});

test("gate refuses a dirty tree", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 5;\n");
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 2);
});

test("green is 3 before the gate and 0 after it", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 0);
});

test("a ledger-only commit keeps the tree green, a code commit does not", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  run(fixture, ["gate", "--tree", tree]);
  fs.appendFileSync(path.join(tree, ".specs-inferno/state.yaml"), "# bookkeeping\n");
  git(tree, ["commit", "-qam", "bookkeeping"]);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 0);

  write(tree, "src/a.ts", "export const a = 6;\n");
  git(tree, ["commit", "-qam", "code"]);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
});

// --- ship ----------------------------------------------------------------
/** Take alpha all the way to the state ship expects: closed, archived, gated. */
function closed(fixture) {
  const { tree, branch } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 7;\n");
  git(tree, ["commit", "-qam", "the work"]);
  const state = path.join(tree, ".specs-inferno/state.yaml");
  for (const id of ["a-one", "a-two"]) {
    execFileSync(process.execPath, [WRITER, "complete-item", "--intent", "alpha", "--item", id, "--file", state], { cwd: tree });
  }
  execFileSync(process.execPath, [WRITER, "close-intent", "--intent", "alpha", "--file", state], { cwd: tree });
  execFileSync(process.execPath, [WRITER, "archive-intent", "--intent", "alpha", "--file", state], { cwd: tree });
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "specsmd(alpha): close and archive"]);
  return { tree, branch };
}

test("ship asks for the gate when the folded tree has no green marker", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 3);
  assert.match(result.out, /run gate first/);
});

test("ship merges, pushes, and tears the worktree and branch down", () => {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /shipped/);
  assert.match(git(fixture.root, ["log", "-1", "--pretty=%s"]), new RegExp(`Merge branch '${branch}'`));
  assert.equal(git(fixture.root, ["rev-parse", "main"]), git(fixture.root, ["rev-parse", "origin/main"]));
  assert.equal(fs.existsSync(tree), false);
  assert.equal(git(fixture.root, ["branch", "--list", branch]).trim(), "");
});

test("ship merges with a dirty primary checkout and keeps its edits", () => {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  // Another session's edit to a file the intent never touched, plus an untracked note.
  write(fixture.root, "docs/b.md", "docs, edited by another session\n");
  write(fixture.root, "HANDOFF.md", "another session's note\n");
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(git(fixture.root, ["log", "-1", "--pretty=%s"]), new RegExp(`Merge branch '${branch}'`));
  assert.equal(fs.readFileSync(path.join(fixture.root, "docs/b.md"), "utf8"), "docs, edited by another session\n");
  assert.equal(fs.existsSync(path.join(fixture.root, "HANDOFF.md")), true);
});

test("ship refuses an intent that is not closed", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /completed/);
});

test("ship refuses when the primary checkout is not on the base branch", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  run(fixture, ["gate", "--tree", tree]);
  git(fixture.root, ["checkout", "-q", "-b", "sidetrack"]);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /main/);
});

// --- dispatch-log --------------------------------------------------------
test("dispatch-log appends one line per dispatch", () => {
  const fixture = repo();
  run(fixture, ["dispatch-log", "alpha", "--item", "a-one", "--tier", "cheap", "--agent", "builder"]);
  const result = JSON.parse(
    run(fixture, ["dispatch-log", "alpha", "--item", "a-two", "--tier", "strong", "--agent", "builder", "--json"]).out
  );
  const log = fs.readFileSync(result.log, "utf8");
  assert.equal(lines(log).length, 2);
  assert.match(log, /a-one\tcheap\tbuilder/);
});
