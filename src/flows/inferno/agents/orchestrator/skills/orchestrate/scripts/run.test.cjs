const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { CONFIG, ITEMS, STATE, git, item, lines, opened, repo, run, write } = require("./run-fixture.cjs");

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
  assert.match(result.dispatch_id, /^[0-9a-f-]{36}$/);
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
