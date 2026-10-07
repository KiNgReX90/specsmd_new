const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { git, repo, run, write } = require("./run-fixture.cjs");

// A Codex orchestrator waits on its builders with wait_agent. Asked for 60 s it wakes every
// minute while a builder runs, so the floor lives in Codex config, where prose cannot lower it,
// and the frontier refuses a Codex host until the floor is in place.
const CODEX = ".specs-inferno/config.codex.yaml";
const ARGS = ["--config", CODEX];
const FLOOR = "[features.multi_agent_v2]\nenabled = true\nmin_wait_timeout_ms = 1200000\ndefault_wait_timeout_ms = 1200000\n";

/** A repo with a Codex host config and a Codex home holding `home`, or no config file at all. */
function codexRepo(home) {
  const fixture = repo();
  write(fixture.root, CODEX, "delivery:\n  base_branch: main\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "codex host"]);
  const dir = path.join(fixture.dir, "codex-home-under-test");
  fs.mkdirSync(dir, { recursive: true });
  if (home !== undefined) fs.writeFileSync(path.join(dir, "config.toml"), home, "utf8");
  return { fixture, env: { CODEX_HOME: dir } };
}

const frontier = ({ fixture, env }, extra = []) => run(fixture, ["frontier", "alpha", ...extra], { env });

test("a Codex host without the wait floor is refused with the lines and the file they go in", () => {
  const codex = codexRepo();
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[NO_WAIT_FLOOR\]/);
  assert.ok(result.err.includes(FLOOR.trim()), result.err);
  assert.ok(result.err.includes(path.join(codex.fixture.root, ".codex", "config.toml")), result.err);
});

test("the floor in the Codex home lets the frontier run", () => {
  const result = frontier(codexRepo(`model = "m"\n\n${FLOOR}`), ARGS);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready a-one /m);
});

test("the floor in the primary checkout's project config counts for a run in a worktree", () => {
  const codex = codexRepo();
  write(codex.fixture.root, ".codex/config.toml", FLOOR);
  const tree = path.join(codex.fixture.dir, "wt");
  git(codex.fixture.root, ["worktree", "add", "-q", "-b", "inferno-intent/wt", tree]);
  const result = frontier(codex, ["--tree", tree, ...ARGS]);
  assert.equal(result.code, 0, result.out + result.err);
});

test("a floor below 20 minutes is refused, naming the file that sets it and the value to set", () => {
  const codex = codexRepo(FLOOR.replace("min_wait_timeout_ms = 1200000", "min_wait_timeout_ms = 60_000"));
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  const home = path.join(codex.env.CODEX_HOME, "config.toml");
  assert.ok(result.err.includes(`${home} sets min_wait_timeout_ms = 60000`), result.err);
  assert.match(result.err, /set min_wait_timeout_ms and default_wait_timeout_ms to 1200000/);
});

test("the key counts only under [features.multi_agent_v2]", () => {
  const other = "[features.multi_agent]\nmin_wait_timeout_ms = 1200000\n[features.multi_agent_v2]\nenabled = true\n";
  assert.equal(frontier(codexRepo(other), ARGS).code, 2);
  const after = "[features.multi_agent_v2]\nenabled = true\n[agents]\nmin_wait_timeout_ms = 1200000\n";
  assert.equal(frontier(codexRepo(after), ARGS).code, 2);
  const spaced = " [ features.multi_agent_v2 ] # wait floor\n  min_wait_timeout_ms = 1_200_000 # 20 min\n";
  assert.equal(frontier(codexRepo(spaced), ARGS).code, 0);
});

test("a project config overrides the Codex home, so a lower project floor is refused", () => {
  const codex = codexRepo(FLOOR);
  write(codex.fixture.root, ".codex/config.toml", FLOOR.replace(/= 1200000/g, "= 60000"));
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  assert.ok(result.err.includes(path.join(codex.fixture.root, ".codex", "config.toml")), result.err);
});

test("a Claude host is never checked for the Codex wait floor", () => {
  const codex = codexRepo();
  assert.equal(frontier(codex).code, 0);
});
