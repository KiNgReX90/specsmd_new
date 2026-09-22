const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

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
  - id: delta
    title: "Delta"
    status: blocked
    blocked_at: 2026-09-02T00:00:00Z
    blocked_reason: "waits on the recapture the finished application allows"
    depends_on_intents: []
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
  const readRows = (entries) =>
    (entries || [])
      .map(
        (p) =>
          `    - path: ${p}\n      source: the command behind ${p}\n` +
          `      when: at mount and on every arrival\n      stale: the screen keeps a value ${p} moved past`,
      )
      .join("\n");

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
${spec.reads ? `reads:\n${readRows(spec.reads)}` : ""}
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
  // alpha depends on an intent that shipped and archived, which is where a shipped
  // prerequisite answers from.
  write(root, ".specs-inferno/archive/state.yaml", "intents:\n  - id: gone-to-archive\n    status: completed\n");
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
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache, ...(options.env || {}) },
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

// A parked intent exists and cannot be built yet. It used to fall through the loop and
// appear nowhere, so the only record of it was the ledger nobody reads mid-run.
test("select lists a blocked intent with its reason and never offers it", () => {
  const fixture = repo();
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);

  assert.deepEqual(result.claimable.map((entry) => entry.id), ["alpha"]);
  assert.deepEqual(result.blocked.map((entry) => entry.id), ["beta"]);
  assert.deepEqual(result.parked.map((entry) => entry.id), ["delta"]);
  assert.equal(result.parked[0].status, "blocked");
  assert.match(result.parked[0].reason, /waits on the recapture/);
  assert.match(run(fixture, ["select"]).out, /parked delta {2}blocked: waits on the recapture/);
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

test("select recovers a claimed intent whose worktree has been idle past the window once its session is gone", () => {
  const fixture = repo();
  const { tree, branch } = opened(fixture);
  const threeHoursAgo = `@${Math.floor(Date.now() / 1000) - 3 * 3600} +0000`;
  git(tree, ["commit", "-q", "--amend", "--no-edit", "--date", threeHoursAgo], {
    GIT_COMMITTER_DATE: threeHoursAgo,
  });
  // The session that opened the tree is this test, alive; recovery is for the one that died.
  fs.rmSync(path.join(fixture.cache, "specsmd-inferno", "app", branch, "owner.json"), { force: true });
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  const alpha = result.recovery.find((entry) => entry.id === "alpha");
  assert.ok(alpha, "alpha is a recovery candidate");
  assert.match(alpha.reason, /idle for \d+ min/);
  assert.equal(alpha.tree, tree);
});

test("select uses the selected host recovery window", () => {
  const config = CONFIG.replace("delivery:", "recovery:\n  idle_minutes: 1000\ndelivery:");
  const fixture = repo({ config });
  const { tree, branch } = opened(fixture);
  idled(tree);
  fs.rmSync(path.join(fixture.cache, "specsmd-inferno", "app", branch, "owner.json"), { force: true });
  write(
    fixture.root,
    ".specs-inferno/config.codex.yaml",
    "recovery:\n  idle_minutes: 1\n",
  );

  const selected = JSON.parse(
    run(fixture, ["select", "--config", ".specs-inferno/config.codex.yaml", "--json"]).out,
  );
  assert.ok(selected.recovery.some((entry) => entry.id === "alpha"));
});

const owner = require("./run-owner.cjs");
const LINUX = process.platform === "linux" && fs.existsSync("/proc/self/stat");

/** Make the worktree look abandoned by the old signals: no process, last commit three hours ago. */
function idled(tree) {
  const threeHoursAgo = `@${Math.floor(Date.now() / 1000) - 3 * 3600} +0000`;
  git(tree, ["commit", "-q", "--amend", "--no-edit", "--date", threeHoursAgo], { GIT_COMMITTER_DATE: threeHoursAgo });
}

function cacheOf(fixture, branch) {
  return path.join(fixture.cache, "specsmd-inferno", "app", branch);
}

// A live session waiting on a detached gate looks exactly like an abandoned tree to the two
// old signals, and on 2026-09-10 a second session recovered one and both gates went red on
// each other's binary. The owner record is what tells them apart.
test("select reports an intent as running, never recovering, while its owner session is alive", { skip: !LINUX }, () => {
  const fixture = repo();
  const { tree, branch } = opened(fixture);
  idled(tree);
  fs.mkdirSync(cacheOf(fixture, branch), { recursive: true });
  fs.writeFileSync(
    path.join(cacheOf(fixture, branch), "owner.json"),
    JSON.stringify({ pid: process.pid, start: owner.processStart(process.pid), step: "gate", at: new Date().toISOString() })
  );
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.ok(!result.recovery.some((entry) => entry.id === "alpha"), "alpha is not offered for recovery");
  const running = result.running.find((entry) => entry.id === "alpha");
  assert.equal(running.kind, "session");
  assert.equal(running.pid, process.pid);
  assert.match(run(fixture, ["select"]).out, /running alpha {2}owned by live session pid \d+, last step gate \d+ min ago/);
});

test("select reports an intent as running while a detached gate is alive for it, and recovers it once the gate is gone", { skip: !LINUX }, async () => {
  const fixture = repo();
  const { tree, branch } = opened(fixture);
  idled(tree);
  // Opening the worktree stamped this test's own session as owner; the case is the gate alone.
  fs.rmSync(path.join(cacheOf(fixture, branch), "owner.json"), { force: true });
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)", "run.cjs"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.mkdirSync(cacheOf(fixture, branch), { recursive: true });
  fs.writeFileSync(path.join(cacheOf(fixture, branch), "gate-job.json"), JSON.stringify({ pid: child.pid, started: "2026-09-10T12:47:11Z" }));
  try {
    const result = JSON.parse(run(fixture, ["select", "--json"]).out);
    assert.ok(!result.recovery.some((entry) => entry.id === "alpha"));
    assert.equal(result.running.find((entry) => entry.id === "alpha").kind, "gate");
  } finally {
    child.kill("SIGKILL");
  }
  await new Promise((resolve) => child.on("exit", resolve));
  const after = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.ok(after.recovery.some((entry) => entry.id === "alpha"), "with the gate gone the idle tree is recoverable again");
});

test("a tree-bound step stamps the session running it as the tree's owner", { skip: !LINUX }, () => {
  const fixture = repo();
  const { tree, branch } = opened(fixture);
  const file = path.join(cacheOf(fixture, branch), "owner.json");
  const session = owner.sessionProcess();
  assert.equal(fs.existsSync(file), session !== null, "worktree stamps the owner exactly when a session can be found");
  if (!session) return;
  fs.rmSync(file);
  run(fixture, ["frontier", "alpha", "--tree", tree]);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(record.pid, session.pid);
  assert.equal(record.step, "frontier");
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

// A run cannot start under bloated instructions: the standing text a worker loads is paid on
// every round of every builder, and the loop that grew it only stops where the claim refuses.
test("claim refuses while the flow text a builder loads is over its budget", () => {
  const fixture = repo();
  write(fixture.root, ".agents/skills/specsmd-inferno-builder/references/procedure.md", "step ".repeat(4100) + "\n");
  // The budget script itself is a machine-local tool named by INFERNO_FLOW_BUDGET; what the
  // claim owns is calling it and refusing on a non-zero exit, so the stub stands in for it.
  const budget = path.join(fixture.root, "budget.py");
  fs.writeFileSync(budget, [
    "import pathlib, sys",
    "p = pathlib.Path('.agents/skills/specsmd-inferno-builder/references/procedure.md')",
    "words = len(p.read_text().split()) if p.exists() else 0",
    "if words > 4000:",
    "    print(f'OVER codex builder: {words} words')",
    "    sys.exit(1)",
  ].join("\n") + "\n");
  const result = run(fixture, ["claim", "alpha"], { env: { INFERNO_FLOW_BUDGET: budget } });
  assert.notEqual(result.code, 0, result.out + result.err);
  assert.match(result.out + result.err, /FLOW_TEXT_OVER_BUDGET/);
  assert.match(result.out + result.err, /OVER codex builder/);
  assert.doesNotMatch(git(fixture.root, ["log", "-1", "--pretty=%s"]).trim(), /claim intent/);
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
test("frontier takes a well-formed reads block and refuses one whose path is not on disk", () => {
  const good = { ...ITEMS, "alpha/a-one": item({ id: "a-one", intent: "alpha", reads: ["src/a.ts"] }) };
  assert.equal(run(repo({ items: good }), ["frontier", "alpha"]).code, 0);

  const broken = {
    ...ITEMS,
    "alpha/a-one": item({ id: "a-one", intent: "alpha", reads: ["src/ghost-read.ts"] }),
  };
  const result = run(repo({ items: broken }), ["frontier", "alpha"]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /src\/ghost-read\.ts/);
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

test("verify-item ignores a file an earlier item already committed on the branch", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/b.ts", "export const b = 9;\n");
  git(tree, ["commit", "-qam", "a-two landed first"]);
  const result = run(fixture, ["verify-item", "a-one", "--tree", tree]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /ownership clean since HEAD/);
});

// --- integrate -----------------------------------------------------------
// The cheap checks run after every item lands, on the committed tree with the base folded in,
// so a builder that broke them is corrected warm and the gate keeps only the suites worth
// running once (2026-09-06).
const INTEGRATE = CONFIG.replace("  finalize_scopes:", "  integrate:\n    - echo integrate ran\n  finalize_scopes:");

test("integrate folds the base in and runs the integrate list on the landed tree", () => {
  const fixture = repo({ config: INTEGRATE });
  const { tree } = opened(fixture);
  write(fixture.root, "src/c.ts", "export const c = 3;\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved"]);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  const result = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /folded main into/);
  assert.match(result.out, /PASS \d+s echo integrate ran/);
  assert.ok(fs.existsSync(path.join(tree, "src/c.ts")), "the fold brought main's file in");
});

// The cargo tree was left out of the integrate list for cost, and an item merged eight broken
// Rust cases through a green integrate (2026-09-10). Scoped the way the gate scopes it, a
// command costs nothing on a branch that never touched its paths.
test("integrate skips a scoped command the branch never reached, and runs it once the branch does", () => {
  const config = INTEGRATE.replace("    - echo integrate ran", "    - echo integrate ran\n    - echo scoped");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  const untouched = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(untouched.code, 0, untouched.out + untouched.err);
  assert.match(untouched.out, /SKIP echo scoped \(no path in scope changed\)/);
  write(tree, "docs/b.md", "docs moved\n");
  git(tree, ["commit", "-qam", "docs landed"]);
  const reached = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(reached.code, 0, reached.out + reached.err);
  assert.match(reached.out, /PASS \d+s echo scoped/);
});

test("integrate stops at the first failing command and points at its log", () => {
  const config = INTEGRATE.replace("    - echo integrate ran", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out, /FAIL/);
  assert.match(result.out, /the reason/);
  const log = /-> (\S+)/.exec(result.out)[1];
  assert.match(log, /integrate-/);
});

test("integrate refuses a dirty tree and folds only when the config lists nothing", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 5;\n");
  assert.equal(run(fixture, ["integrate", "--tree", tree]).code, 2);
  git(tree, ["commit", "-qam", "landed"]);
  const result = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /no verification.integrate list/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3, "integrate never writes the green marker");
});

// --- gate / green --------------------------------------------------------
// Running every missing proof, reusing it on an unchanged tree and the verdict either side of
// the gate are proved in run-gate.test.cjs, which also counts the command executions.
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

// The marker is keyed on the code tree, and the gate used to key it on the tree as it stood when
// the last command finished. A commit landing mid-run then minted a green for code no command
// had read (2026-09-06: nine journeys ran, the committed pick wanted eleven).
test("a commit landing while the gate runs leaves no green marker", () => {
  const config = CONFIG.replace(
    "    - echo always",
    "    - printf 'export const a = 7;\\n' > src/a.ts; git commit -qam mid-gate",
  );
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out + result.err, /changed while the gate ran/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
});

// --- gate --detach / --wait ------------------------------------------------
// The gate outruns the cap a host puts on one tool call, and a background tool call is
// orphaned when a headless run ends its turn. So the gate runs as its own process and the
// orchestrator blocks on it in slices: 0 green, 2 red, 4 still running.
const SLOW = CONFIG.replace("    - echo always", "    - sleep 2; echo slow");

test("gate --detach starts the gate in its own process and --wait reports it green", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const started = run(fixture, ["gate", "--tree", tree, "--detach"]);
  assert.equal(started.code, 0, started.out + started.err);
  assert.match(started.out, /gate started pid \d+/);
  assert.match(started.out, /gate --wait/);
  // An interactive orchestrator waits with one shell loop on the result file instead of
  // re-calling --wait every nine minutes at a full context round (26 rounds on 2026-09-08),
  // so --detach names that file beside the pid.
  const named = started.out.match(/^result (\S+gate-job\.result\.json)$/m);
  assert.ok(named, `no result line in: ${started.out}`);

  const waited = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.5"]);
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.ok(fs.statSync(named[1]).size > 0, "the named result file holds the verdict");
  assert.match(waited.out, /PASS \d+s echo always/);
  assert.match(waited.out, /PASS \d+s echo scoped/);
  assert.match(waited.out, /green/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 0);
});

test("gate --wait exits 4 while the gate still runs, refuses a second start, and finishes on the next call", () => {
  const fixture = repo({ config: SLOW });
  const { tree } = opened(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 0);
  const second = run(fixture, ["gate", "--tree", tree, "--detach"]);
  assert.equal(second.code, 2);
  assert.match(second.out + second.err, /already running/);
  const early = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.01"]);
  assert.equal(early.code, 4, early.out + early.err);
  assert.match(early.out, /still running pid \d+/);
  const done = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.5"]);
  assert.equal(done.code, 0, done.out + done.err);
  assert.match(done.out, /PASS \d+s sleep 2; echo slow/);
});

test("gate --wait reports a red gate with the failing command and its log", () => {
  const config = CONFIG.replace("    - echo always", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 0);
  const waited = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.5"]);
  assert.equal(waited.code, 2, waited.out + waited.err);
  assert.match(waited.out, /FAIL \d+s echo the reason; exit 3 -> /);
  assert.match(waited.out, /the reason/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
});

test("gate --wait without a started gate says how to start one", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["gate", "--tree", tree, "--wait"]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /gate --detach/);
});

test("gate --detach refuses a dirty tree before starting anything", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 8;\n");
  assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 2);
  assert.equal(run(fixture, ["gate", "--tree", tree, "--wait"]).code, 2);
});

// --- ship ----------------------------------------------------------------
/** Take alpha all the way to the state ship expects: closed, archived, gated. */
function closed(fixture) {
  const { tree, branch } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 7;\n");
  git(tree, ["commit", "-qam", "the work"]);
  const state = path.join(tree, ".specs-inferno/state.yaml");
  const proof = git(tree, ["rev-parse", "--short", "HEAD"]).trim();
  for (const id of ["a-one", "a-two"]) {
    execFileSync(
      process.execPath,
      [WRITER, "complete-item", "--intent", "alpha", "--item", id, "--file", state, "--proof", proof],
      { cwd: tree },
    );
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

// --- teardown ------------------------------------------------------------
/** Merge alpha by hand from the primary checkout, the way a host without the gate does. */
function mergedByHand(fixture) {
  const { tree, branch } = closed(fixture);
  git(fixture.root, ["merge", "-q", "--no-ff", "-m", `Merge branch '${branch}'`, branch]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return { tree, branch };
}

test("teardown removes a merged worktree and its branch", () => {
  const fixture = repo();
  const { tree, branch } = mergedByHand(fixture);
  const result = run(fixture, ["teardown", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.existsSync(tree), false);
  assert.equal(git(fixture.root, ["branch", "--list", branch]).trim(), "");
});

test("teardown resolves its base from the selected host config", () => {
  const fixture = repo();
  const { tree } = mergedByHand(fixture);
  write(
    fixture.root,
    ".specs-inferno/config.yaml",
    CONFIG.replace("base_branch: main", "base_branch: missing-base"),
  );
  write(
    fixture.root,
    ".specs-inferno/config.codex.yaml",
    "delivery:\n  base_branch: main\n",
  );

  const result = run(fixture, [
    "teardown",
    "--tree",
    tree,
    "--config",
    ".specs-inferno/config.codex.yaml",
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.existsSync(tree), false);
});

test("teardown refuses a worktree whose commits the base does not hold", () => {
  const fixture = repo();
  const { tree, branch } = mergedByHand(fixture);
  write(tree, "src/a.ts", "export const a = 9;\n");
  git(tree, ["commit", "-qam", "work after the merge"]);
  const result = run(fixture, ["teardown", "--tree", tree]);

  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /Ship it first/);
  assert.equal(fs.existsSync(tree), true);
  assert.notEqual(git(fixture.root, ["branch", "--list", branch]).trim(), "");
});

test("teardown refuses the worktree of an intent still in progress", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["teardown", "--tree", tree]);

  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /in progress/);
  assert.equal(fs.existsSync(tree), true);
});

test("select names a merged worktree its intent no longer needs as a leftover", () => {
  const fixture = repo();
  const { tree, branch } = mergedByHand(fixture);
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.deepEqual(result.leftovers, [{ id: "alpha", path: tree, branch }]);
  assert.match(run(fixture, ["select"]).out, new RegExp(`leftover alpha  ${tree}`));
});

test("select never calls a claimed intent's worktree a leftover", () => {
  const fixture = repo();
  opened(fixture);
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.deepEqual(result.leftovers, []);
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

// --- gate folds the base in ---------------------------------------------
/** Move the base branch on after the intent forked, the way another intent's ship does. */
function baseMoved(fixture, rel = "docs/moved.md", body = "main moved\n") {
  write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved while the intent was open"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
}

test("gate folds the base branch in first, so the tree it proves is the tree that ships", () => {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  baseMoved(fixture);

  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.match(gate.out, new RegExp(`folded main into ${branch}`));
  assert.ok(fs.existsSync(path.join(tree, "docs/moved.md")));
  const ship = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(ship.code, 0, ship.out + ship.err);
});

test("gate says nothing about folding when the base has not moved", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.doesNotMatch(gate.out, /folded/);
});

test("gate folds commits that reached origin but not the local base branch", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const other = path.join(fixture.dir, "other");
  git(fixture.dir, ["clone", "-q", "-b", "main", fixture.remote, other]);
  git(other, ["config", "user.email", "test@example.com"]);
  git(other, ["config", "user.name", "Test"]);
  write(other, "docs/remote.md", "pushed from elsewhere\n");
  git(other, ["add", "-A"]);
  git(other, ["commit", "-qm", "pushed from elsewhere"]);
  git(other, ["push", "-q", "origin", "main"]);

  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.ok(fs.existsSync(path.join(tree, "docs/remote.md")));
  const ship = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(ship.code, 0, ship.out + ship.err);
});

test("gate stops on a fold conflict and names the files", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  baseMoved(fixture, "src/a.ts", "export const a = 9;\n");

  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 2, gate.out + gate.err);
  assert.match(gate.out + gate.err, /conflict folding main into/);
  assert.match(gate.out + gate.err, /src\/a\.ts/);
});

test("gate --detach folds the base in before the gate process starts", () => {
  const fixture = repo({ config: SLOW });
  const { tree, branch } = closed(fixture);
  baseMoved(fixture);

  const started = run(fixture, ["gate", "--tree", tree, "--detach"]);
  assert.equal(started.code, 0, started.out + started.err);
  assert.match(started.out, new RegExp(`folded main into ${branch}`));
  assert.ok(fs.existsSync(path.join(tree, "docs/moved.md")));
  assert.equal(run(fixture, ["gate", "--tree", tree, "--wait"]).code, 0);
  const ship = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(ship.code, 0, ship.out + ship.err);
});

// --- integrate completes the item ----------------------------------------
// Completion is what integrate says once the checks are green. An item marked completed
// and then interrupted used to release its successor on the next run, on a tree nothing
// had verified (2026-09-09).

test("integrate --item completes the item with the sha its checks proved", () => {
  const fixture = repo({ config: INTEGRATE });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  const proved = git(tree, ["rev-parse", "--short", "HEAD"]).trim();

  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /completed a-one/);
  const ledger = fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8");
  assert.match(ledger, new RegExp(`integrated_sha: ${proved}`));
  assert.equal(git(tree, ["status", "--porcelain"]).trim(), "", "integrate commits the ledger it wrote");
  const frontier = JSON.parse(run(fixture, ["frontier", "alpha", "--tree", tree, "--json"]).out);
  assert.deepEqual(frontier.ready.map((entry) => entry.id), ["a-two"]);
});

test("integrate leaves the item open when a check goes red", () => {
  const config = INTEGRATE.replace("    - echo integrate ran", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 2);
  assert.doesNotMatch(fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8"), /integrated_sha/);
});

test("integrate --items completes a batch as one unit", () => {
  const state = STATE.replace("        depends_on: [a-one]", "        depends_on: []");
  const fixture = repo({ config: INTEGRATE, state });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  write(tree, "src/b.ts", "export const b = 5;\n");
  git(tree, ["commit", "-qam", "the batch landed"]);

  const result = run(fixture, ["integrate", "--tree", tree, "--items", "a-one,a-two"]);

  assert.equal(result.code, 0, result.out + result.err);
  const ledger = fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8");
  assert.equal((ledger.match(/integrated_sha:/g) || []).length, 2);
});

// A completed item is never re-validated and never re-dispatched, whatever its proof. It is
// held: its successors wait until an integration proves the tree it landed on.
const INTERRUPTED = STATE.replace(
  /(- id: a-one[\s\S]*?)status: pending/,
  "$1status: completed\n        completed_at: 2026-09-10T09:00:00Z",
);

test("a completed item with no integration proof holds its successor and asks for the proof", () => {
  const fixture = repo({ state: INTERRUPTED });
  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /HELD a-one: completed with no integration proof/);
  assert.match(result.out, /run\.cjs integrate --item a-one --tree/);
  const payload = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(payload.ready.map((entry) => entry.id), []);
  assert.deepEqual(payload.waiting.map((entry) => entry.id), ["a-two"]);
  assert.deepEqual(payload.held, ["a-one"]);
});

test("a completed item is never re-validated, so a path it deleted is not an error", () => {
  const items = {
    ...ITEMS,
    "alpha/a-one": item({ id: "a-one", intent: "alpha", required: ["src/deleted-by-a-one.ts"] }),
  };
  const fixture = repo({ state: INTERRUPTED, items });

  assert.equal(run(fixture, ["frontier", "alpha"]).code, 3, "held, not INVALID");
  assert.doesNotMatch(run(fixture, ["frontier", "alpha"]).out, /INVALID/);
});

// Every ledger the old flow wrote carries completed items and no proof at all. The old
// integrate ran the same checks and recorded nothing, so those count as proved.
const LEGACY = `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: in_progress
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: a-one
        title: "A one"
        kind: behavior
        complexity: low
        status: completed
        completed_at: 2026-09-08T10:00:00Z
        depends_on: []
      - id: a-two
        title: "A two"
        kind: behavior
        complexity: medium
        status: completed
        completed_at: 2026-09-09T07:30:00Z
        depends_on: [a-one]
`;

test("a ledger the old flow completed leaves an empty frontier, not a validation error", () => {
  const items = {
    ...ITEMS,
    "alpha/a-one": item({ id: "a-one", intent: "alpha", required: ["src/routes/dossier/+page.svelte"] }),
  };
  const fixture = repo({ state: LEGACY, items });

  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /no item left in this intent/);
  assert.doesNotMatch(result.out, /INVALID/);
  assert.doesNotMatch(result.out, /HELD/);
});

test("an item the integration proved releases its successor", () => {
  const proved = STATE.replace(
    /(- id: a-one[\s\S]*?)status: pending/,
    "$1status: completed\n        completed_at: 2026-09-10T09:00:00Z\n        integrated_sha: abc1234",
  );
  const fixture = repo({ state: proved });
  const result = run(fixture, ["frontier", "alpha", "--json"]);

  assert.equal(result.code, 0, result.out);
  assert.deepEqual(JSON.parse(result.out).ready.map((entry) => entry.id), ["a-two"]);
});

test("verify-item takes the union of a batch's ownership", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  write(tree, "src/b.ts", "export const b = 5;\n");

  assert.equal(run(fixture, ["verify-item", "a-one", "--tree", tree]).code, 2, "src/b.ts is outside a-one alone");
  const batch = run(fixture, ["verify-item", "--items", "a-one,a-two", "--tree", tree]);
  assert.equal(batch.code, 0, batch.out + batch.err);
  assert.match(batch.out, /ownership clean/);
});

// --- the browser journeys this landing can break -------------------------
// A config with no `integrate_e2e` section runs no browser step, which is the shape both of
// this repo's host configs carry since 2026-09-11: the selection cost as much as the whole
// suite and the finalize gate reran the whole suite anyway, because a proof is keyed on the
// command string.
test("integrate runs no browser step when the config declares no integrate_e2e", () => {
  const fixture = repo({ config: INTEGRATE });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);

  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one", "--json"]);

  assert.equal(result.code, 0, result.out + result.err);
  const payload = JSON.parse(result.out);
  assert.deepEqual(
    payload.results.map(({ command, result }) => ({ command, result })),
    [{ command: "echo integrate ran", result: "pass" }],
  );
  assert.deepEqual(payload.items, ["a-one"]);
  assert.match(fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8"), /integrated_sha/);
});

// integrate ran the cheap checks only, so twenty e2e cases went red at item one of an intent
// and stayed red through item five, met hours later at the finalize gate (2026-09-09).
const E2E = INTEGRATE.replace(
  "  finalize_scopes:",
  `  integrate_e2e:
    command: echo ran
    full: echo the whole suite
    exempt:
      - "**/*.test.ts"
    full_when:
      - "src/**"
    map:
      "src/a.ts": ["e2e/a.spec.ts"]
      "src/c.ts": ["e2e/c.spec.ts"]
  finalize_scopes:`,
);

test("integrate runs the specs the landed source maps to", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);

  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo ran e2e\/a\.spec\.ts/);
});

test("integrate excludes a change the fold brought in from the base", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(fixture.root, "src/c.ts", "export const c = 3;\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved under the intent"]);
  write(tree, "docs/b.md", "docs only\n");
  git(tree, ["commit", "-qam", "b-one landed"]);

  const result = run(fixture, ["integrate", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP e2e \(nothing browser-facing changed\. Base fold paths are excluded\.\)/);
  assert.doesNotMatch(result.out, /echo ran e2e\/c\.spec\.ts/);
});

test("integrate falls back to the whole suite for a source no entry covers", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(tree, "src/b.ts", "export const b = 9;\n");
  git(tree, ["commit", "-qam", "an unmapped source landed"]);

  const result = run(fixture, ["integrate", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo the whole suite/);
});

test("integrate runs no browser journey for a docs-only landing", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(tree, "docs/b.md", "docs only\n");
  git(tree, ["commit", "-qam", "docs landed"]);

  const result = run(fixture, ["integrate", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP e2e \(nothing browser-facing changed\. Base fold paths are excluded\.\)/);
});

test("a red e2e run stops the item short of completion", () => {
  const config = E2E.replace("    command: echo ran", "    command: false");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);

  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /FAIL \d+s false e2e\/a\.spec\.ts/);
  assert.doesNotMatch(fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8"), /integrated_sha/);
});


test("selected lifecycle uses host base and project worktree fallback", () => {
  const fixture = repo({ config: CONFIG.replace("base_branch: main", "base_branch: other-base") });
  git(fixture.root, ["branch", "other-base"]);
  const config = ".specs-inferno/config.codex.yaml";
  write(fixture.root, config, `verification:
  finalize:
    - echo codex
delivery:
  mode: auto-close
  base_branch: main
`);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "add Codex host config"]);

  const claimed = run(fixture, ["claim", "alpha", "--config", config]);
  assert.equal(claimed.code, 0, claimed.out + claimed.err);
  assert.match(claimed.out, /claimed alpha on main/);

  const created = run(fixture, ["worktree", "alpha", "--config", config, "--json"]);
  assert.equal(created.code, 0, created.out + created.err);
  const tree = JSON.parse(created.out).path;
  assert.equal(fs.readFileSync(path.join(tree, "node_modules/marker"), "utf8"), "ran\n");

  const unclaimed = run(fixture, ["unclaim", "alpha", "--config", config]);
  assert.equal(unclaimed.code, 0, unclaimed.out + unclaimed.err);
});

test("ship checks the proofs from its selected host config", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const config = ".specs-inferno/config.codex.yaml";
  write(tree, config, CONFIG.replace("echo always", "echo codex always"));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "Codex gate configuration"]);
  const gated = run(fixture, ["gate", "--tree", tree, "--config", config]);
  assert.equal(gated.code, 0, gated.out + gated.err);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree, "--config", config]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.match(shipped.out, /shipped/);
  assert.equal(fs.existsSync(tree), false);
});
