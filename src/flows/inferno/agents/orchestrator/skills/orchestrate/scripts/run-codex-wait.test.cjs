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

/** The lines a refusal asks for, after the line that names where they go. */
const asked = (err) => err.trim().split("\n").slice(1);

test("a floor below 20 minutes is refused with only the key to set inside the table it has", () => {
  const codex = codexRepo(FLOOR.replace("min_wait_timeout_ms = 1200000", "min_wait_timeout_ms = 60_000"));
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  const home = path.join(codex.env.CODEX_HOME, "config.toml");
  assert.ok(result.err.includes(`${home} defines features.multi_agent_v2 without a wait floor`), result.err);
  assert.match(result.err, /set these keys under \[features\.multi_agent_v2\]/);
  assert.deepEqual(asked(result.err), ["min_wait_timeout_ms = 1200000"]);
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
  assert.deepEqual(asked(off.err), ["enabled = true"]);
  const unset = frontier(codexRepo(FLOOR.replace("enabled = true\n", "")), ARGS);
  assert.deepEqual(asked(unset.err), ["enabled = true"]);
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

test("a table the file already has gets only its missing keys, in its own spelling, and then passes", () => {
  const cases = [
    ["[features.multi_agent_v2]\nenabled = true\n", ["min_wait_timeout_ms = 1200000", "default_wait_timeout_ms = 1200000"]],
    ["[features]\nmulti_agent_v2.enabled = true\n", ["multi_agent_v2.min_wait_timeout_ms = 1200000", "multi_agent_v2.default_wait_timeout_ms = 1200000"]],
    ["features.multi_agent_v2.enabled = true\n", ["features.multi_agent_v2.min_wait_timeout_ms = 1200000", "features.multi_agent_v2.default_wait_timeout_ms = 1200000"]],
  ];
  for (const [text, lines] of cases) {
    const codex = codexRepo();
    write(codex.fixture.root, ".codex/config.toml", text);
    const result = frontier(codex, ARGS);
    assert.equal(result.code, 2, result.out + result.err);
    assert.deepEqual(asked(result.err), lines, text);
    write(codex.fixture.root, ".codex/config.toml", `${text}${lines.join("\n")}\n`);
    assert.equal(frontier(codex, ARGS).code, 0, text);
  }
});

test("an inline table gets its missing keys inside its braces, and a bare switch is replaced whole", () => {
  const inline = codexRepo("[features]\nmulti_agent_v2 = { enabled = true }\n");
  const braces = frontier(inline, ARGS);
  assert.match(braces.err, /inside the braces of multi_agent_v2 = \{ \} under \[features\]/);
  assert.deepEqual(asked(braces.err), ["min_wait_timeout_ms = 1200000, default_wait_timeout_ms = 1200000"]);
  const bare = frontier(codexRepo("[features]\nmulti_agent_v2 = true\n"), ARGS);
  assert.match(bare.err, /replace multi_agent_v2 = true under \[features\] with this line/);
  const line = asked(bare.err)[0];
  assert.equal(line, "multi_agent_v2 = { enabled = true, min_wait_timeout_ms = 1200000, default_wait_timeout_ms = 1200000 }");
  assert.equal(frontier(codexRepo(`[features]\n${line}\n`), ARGS).code, 0);
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
