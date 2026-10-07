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

/** The one refusal: the file, what to clear in it, and the canonical table to append. */
const refusal = (file, inline = false) => `ERROR [NO_WAIT_FLOOR] ${file} holds no wait floor Codex applies, so wait_agent ` +
  "can wake the orchestrator before a builder returns." +
  (inline ? " It sets features = { } inline, so first move the keys that stay in it under a [features] table at the end of the file." : "") +
  " Remove every other multi_agent_v2 setting in that file, a table, a dotted key or an inline table, and append this " +
  `table at its end:\n${FLOOR}`;

test("a Codex host without the wait floor is refused with the table and the file it goes in", () => {
  const codex = codexRepo();
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.err, refusal(path.join(codex.fixture.root, ".codex", "config.toml")));
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

test("a floor below 20 minutes is refused with the same table, naming the file that sets it", () => {
  const codex = codexRepo(FLOOR.replace("min_wait_timeout_ms = 1200000", "min_wait_timeout_ms = 60_000"));
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.err, refusal(path.join(codex.env.CODEX_HOME, "config.toml")));
});

test("the key counts only under [features.multi_agent_v2]", () => {
  const other = "[features.multi_agent]\nmin_wait_timeout_ms = 1200000\n[features.multi_agent_v2]\nenabled = true\n";
  assert.equal(frontier(codexRepo(other), ARGS).code, 2);
  const after = "[features.multi_agent_v2]\nenabled = true\n[agents]\nmin_wait_timeout_ms = 1200000\n";
  assert.equal(frontier(codexRepo(after), ARGS).code, 2);
  const spaced = " [ features.multi_agent_v2 ] # wait floor\n  enabled = true # on\n  min_wait_timeout_ms = 1_200_000 # 20 min\n  default_wait_timeout_ms = 1200000\n";
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

// Every case below was read by codex-cli 0.159 itself (`codex features list` on a temp
// CODEX_HOME): a floor counts where Codex applies it, and nowhere else.
test("a table inside a multi-line string is no floor", () => {
  for (const quote of ['"""', "'''"]) {
    const text = `developer_instructions = ${quote}\n${FLOOR}${quote}\n`;
    assert.equal(frontier(codexRepo(text), ARGS).code, 2, quote);
  }
  const closed = `note = """one line"""\n${FLOOR}`;
  assert.equal(frontier(codexRepo(closed), ARGS).code, 0);
});

test("the floor counts only while the table is enabled", () => {
  const off = frontier(codexRepo(FLOOR.replace("enabled = true", "enabled = false")), ARGS);
  assert.equal(off.code, 2, off.out + off.err);
  assert.ok(off.err.endsWith(`:\n${FLOOR}`), off.err);
  assert.equal(frontier(codexRepo(FLOOR.replace("enabled = true\n", "")), ARGS).code, 2);
});

test("a minimum without a default as high is refused, since Codex will not load it", () => {
  const result = frontier(codexRepo(FLOOR.replace("default_wait_timeout_ms = 1200000\n", "")), ARGS);
  assert.equal(result.code, 2, result.out + result.err);
});

test("a quoted table name, dotted keys and an inline table all carry the floor", () => {
  const keys = (prefix) => ["enabled = true", "min_wait_timeout_ms = 1200000", "default_wait_timeout_ms = 1200000"]
    .map((line) => `${prefix}${line}`).join("\n");
  const spellings = {
    quoted: `[features."multi_agent_v2"]\n${keys("")}\n`,
    literal: `[ 'features' . 'multi_agent_v2' ]\n${keys("")}\n`,
    top: `${keys("features.multi_agent_v2.")}\n`,
    spaced: `${keys('features . "multi_agent_v2" . ')}\n`,
    features: `[features]\n${keys("multi_agent_v2.")}\n`,
    inline: `[features]\nmulti_agent_v2 = { ${keys("").split("\n").join(", ")} }\n`,
  };
  for (const [name, text] of Object.entries(spellings)) {
    const result = frontier(codexRepo(text), ARGS);
    assert.equal(result.code, 0, `${name}: ${result.err}`);
  }
});

// Each spelling, its refusal applied as written: every other multi_agent_v2 setting removed, an
// inline features table turned into a [features] table, and the printed table appended. Each
// fixed file was loaded by codex-cli 0.159 `features list`, which reads multi_agent_v2 true.
const SPELLINGS = [
  ["top-level dotted", 'model = "m"\nfeatures.multi_agent_v2.enabled = true\n', 'model = "m"\n'],
  ["top-level inline", "features.multi_agent_v2 = { enabled = true }\n", ""],
  ["features inline", "features = { multi_agent_v2 = { enabled = true }, apps = true }\n", "[features]\napps = true\n", true],
  ["quoted header", '[features."multi_agent_v2"]\nenabled = true\nmin_wait_timeout_ms = 60000\ndefault_wait_timeout_ms = 60000\n', ""],
  ["partial table", "[features.multi_agent_v2]\nenabled = true\n[notice]\nhide_rate_limit_model_nudge = true\n", "[notice]\nhide_rate_limit_model_nudge = true\n"],
  ["disabled", "[features]\nmulti_agent_v2.enabled = false\napps = true\n", "[features]\napps = true\n"],
];

test("every spelling gets the one refusal, and the file fixed as it says passes", () => {
  for (const [name, text, kept, inline] of SPELLINGS) {
    const codex = codexRepo();
    const file = path.join(codex.fixture.root, ".codex", "config.toml");
    write(codex.fixture.root, ".codex/config.toml", text);
    const result = frontier(codex, ARGS);
    assert.equal(result.err, refusal(file, inline), name);
    const table = result.err.slice(result.err.indexOf(":\n[") + 2);
    write(codex.fixture.root, ".codex/config.toml", `${kept}${table}`);
    assert.equal(frontier(codex, ARGS).code, 0, name);
  }
});

test("a Codex tree outside git reads its own project config", () => {
  const codex = codexRepo();
  const plain = path.join(codex.fixture.dir, "plain");
  fs.cpSync(codex.fixture.root, plain, { recursive: true, filter: (src) => path.basename(src) !== ".git" });
  write(plain, ".codex/config.toml", FLOOR);
  const result = run(codex.fixture, ["frontier", "alpha", "--tree", plain, ...ARGS], { cwd: plain, env: codex.env });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready a-one /m);
});
