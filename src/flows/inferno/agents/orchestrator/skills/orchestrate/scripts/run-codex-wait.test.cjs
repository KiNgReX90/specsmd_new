const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { git, repo, run, write } = require("./run-fixture.cjs");
const { codexStub } = require("./review-fixture.cjs");

// A Codex orchestrator waits on its builders with wait_agent. Asked for 60 s it wakes every
// minute while a builder runs, so the floor lives in Codex config, where prose cannot lower it,
// and the frontier refuses a Codex host until Codex itself reports the floor in place.
const CODEX = ".specs-inferno/config.codex.yaml";
const ARGS = ["--config", CODEX];
const FLOOR = "[features.multi_agent_v2]\nenabled = true\nmin_wait_timeout_ms = 1200000\ndefault_wait_timeout_ms = 1200000\n";

/** A repo with a Codex host config, a Codex home holding `home`, and a project config `project`. */
function codexRepo({ home = "", project, trusted = true, codex = "codex" } = {}) {
  const fixture = repo();
  write(fixture.root, CODEX, "delivery:\n  base_branch: main\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "codex host"]);
  const primary = fs.realpathSync(fixture.root);
  const dir = path.join(fixture.dir, "codex-home-under-test");
  const trust = trusted ? `\n[projects."${primary}"]\ntrust_level = "trusted"\n` : "";
  write(dir, "config.toml", `${home}${trust}`);
  const P = path.join(primary, ".codex", "config.toml");
  if (project !== undefined) write(primary, ".codex/config.toml", project);
  return { fixture, primary, P, home: path.join(dir, "config.toml"), env: { CODEX_HOME: dir, SPECSMD_CODEX: codex } };
}

const frontier = ({ fixture, env }, extra = []) => run(fixture, ["frontier", "alpha", ...extra], { env });
const refused = (codex) => {
  const result = frontier(codex, ARGS);
  assert.equal(result.code, 2, result.out + result.err);
  return result.err;
};
const passes = (codex, extra = []) => {
  const result = frontier(codex, [...extra, ...ARGS]);
  assert.equal(result.code, 0, result.out + result.err);
};

// The refusals, word for word.
const E = "ERROR [NO_WAIT_FLOOR] ";
const same = (primary) => `Codex applies no wait floor in ${primary}, so wait_agent can wake the orchestrator before a builder returns.`;
const trusted = (c) => `Codex reads a project config only in a trusted project. If ${c.primary} is not one yet, start codex in ` +
  `${c.primary} and accept the trust prompt, or set trust_level = "trusted" in the [projects] entry for ${c.primary} in ${c.home}.`;
const R3 = (c) => `${E}${same(c.primary)} ${trusted(c)} Append this table at the end of ${c.P}, creating the file if it is missing:\n${FLOOR}`;
const R4 = (c, cause) => `${E}${same(c.primary)} ${trusted(c)} Codex cannot load ${c.P} with this table appended (${cause}). Rewrite every ` +
  "multi_agent_v2 setting in that file as this one table, keeping the other keys it sets, and turn an inline features = { } " +
  `into a [features] table:\n${FLOOR}`;
const R2 = (c) => `${E}${c.P} holds the wait floor, but Codex reads a project config only in a trusted project, and ` +
  `${c.primary} is not one. Start codex in ${c.primary} and accept the trust prompt, or set trust_level = "trusted" in the ` +
  `[projects] entry for ${c.primary} in ${c.home}.\n`;
const R1 = (c, cause) => `${E}Codex cannot load its config in ${c.primary}: ${cause}. Correct what it names, then run the frontier again.\n`;
const R5 = (cmd) => `${E}The wait floor check runs codex features list, and ${cmd} is not on PATH here. Put codex on PATH or set ` +
  "SPECSMD_CODEX to it, then run the frontier again.\n";
const trust = (c) => fs.appendFileSync(c.home, `\n[projects."${c.primary}"]\ntrust_level = "trusted"\n`);

// --- on the real codex: each refusal applied as printed, then the frontier runs ---------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-"));
const probe = spawnSync("codex", ["features", "list"], { encoding: "utf8", cwd: scratch, env: { ...process.env, CODEX_HOME: scratch } });
fs.rmSync(scratch, { recursive: true, force: true });
const real = { skip: probe.status === 0 ? false : `codex features list fails here (${probe.error ? probe.error.code : `exit ${probe.status}`})` };

test("the floor in the Codex home passes", real, () => passes(codexRepo({ home: FLOOR })));

test("the floor in the primary checkout's project config passes for a run in a worktree", real, () => {
  const c = codexRepo({ project: FLOOR });
  const tree = path.join(c.fixture.dir, "wt");
  git(c.fixture.root, ["worktree", "add", "-q", "-b", "inferno-intent/wt", tree]);
  passes(c, ["--tree", tree]);
});

test("no floor anywhere asks for the table appended to the project config", real, () => {
  const c = codexRepo();
  assert.equal(refused(c), R3(c));
  write(c.primary, ".codex/config.toml", FLOOR);
  passes(c);
});

test("an untrusted project without the floor asks for the table and the trust in one refusal", real, () => {
  const c = codexRepo({ trusted: false });
  assert.equal(refused(c), R3(c));
  write(c.primary, ".codex/config.toml", FLOOR);
  trust(c);
  passes(c);
});

test("a project config without a final newline gets the table on a line of its own", real, () => {
  const c = codexRepo({ project: 'model = "m"' });
  assert.equal(refused(c), R3(c));
  fs.appendFileSync(c.P, `\n${FLOOR}`);
  passes(c);
});

test("a minimum of 1199999 is refused and 1200000 passes", real, () => {
  const c = codexRepo({ home: FLOOR.replace(/1200000/g, "1199999") });
  assert.equal(refused(c), R3(c));
  write(c.primary, ".codex/config.toml", FLOOR);
  passes(c);
});

test("a table inside a multi-line string is no floor", real, () => {
  const text = `developer_instructions = """\n${FLOOR}"""\n`;
  const c = codexRepo({ project: text });
  assert.equal(refused(c), R3(c));
  fs.appendFileSync(c.P, FLOOR);
  passes(c);
});

test("an inline features table in the project is rewritten as the table", real, () => {
  const c = codexRepo({ home: FLOOR, project: "features = { multi_agent_v2 = false }\n" });
  assert.equal(refused(c), R4(c, "cannot extend value of type inline table with a dotted key"));
  fs.writeFileSync(c.P, FLOOR);
  passes(c);
});

test("a partial table keeps its other keys when it is rewritten", real, () => {
  const key = "max_concurrent_threads_per_session = 4\n";
  const c = codexRepo({ project: `[features.multi_agent_v2]\nenabled = true\n${key}` });
  assert.equal(refused(c), R4(c, "duplicate key"));
  fs.writeFileSync(c.P, `${FLOOR}${key}`);
  passes(c);
  assert.ok(fs.readFileSync(c.P, "utf8").includes(key));
});

test("a minimum without a default is rewritten as the table", real, () => {
  const c = codexRepo({ project: "[features.multi_agent_v2]\nenabled = true\nmin_wait_timeout_ms = 1200000\n" });
  assert.equal(refused(c), R4(c, "duplicate key"));
  fs.writeFileSync(c.P, FLOOR);
  passes(c);
});

test("a floor in an untrusted project asks for the trust", real, () => {
  const c = codexRepo({ project: FLOOR, trusted: false });
  assert.equal(refused(c), R2(c));
  trust(c);
  passes(c);
});

test("a Codex home that does not parse names the file and line Codex names", real, () => {
  const c = codexRepo({ home: "[features\n" });
  assert.equal(refused(c), R1(c, `${c.home}:1:10: unclosed table, expected \`]\``));
  fs.writeFileSync(c.home, FLOOR);
  trust(c);
  passes(c);
});

// --- on a stand-in codex, everywhere ---------------------------------------------------------
const stub = (c, body, name) => ({ ...c, env: { ...c.env, SPECSMD_CODEX: codexStub(path.join(c.fixture.dir, "stubs", "cache"), body, name) } });
const NONE = '#!/bin/sh\necho "multi_agent_v2  stable  false"';
const OTHER = '#!/bin/sh\ncase "$*" in *-c*) echo "Caused by:\n    0: x.toml:1:1: something else" >&2; exit 1;; esac\necho "multi_agent_v2  stable  true"';

test("a codex that reports the floor lets the frontier run", () => passes(stub(codexRepo(), undefined, "holds")));

test("a floor that the table appended cannot turn on is laid at a layer outside both files", () => {
  const c = stub(codexRepo(), NONE, "none");
  assert.equal(refused(c), `${E}${same(c.primary)} Codex loads ${c.P} with this table appended and the floor still does ` +
    `not hold, so a config layer outside ${c.P} and ${c.home} turns it off. Remove the multi_agent_v2 setting from that ` +
    "layer, then run the frontier again.\n");
});

test("a load that fails on the minimum gets the floor's fix, any other failure names its cause", () => {
  const minimum = '#!/bin/sh\nprintf "Caused by:\\n    features.multi_agent_v2.default_wait_timeout_ms must be at least ' +
    'features.multi_agent_v2.min_wait_timeout_ms\\n" >&2\nexit 1';
  const floor = stub(codexRepo(), minimum, "minimum");
  assert.equal(refused(floor), R4(floor, "features.multi_agent_v2.default_wait_timeout_ms must be at least " +
    "features.multi_agent_v2.min_wait_timeout_ms"));
  const broken = stub(codexRepo(), '#!/bin/sh\nprintf "Caused by:\\n    0: /x/config.toml:1:10: unclosed table\\n" >&2\nexit 1', "broken");
  assert.equal(refused(broken), R1(broken, "/x/config.toml:1:10: unclosed table"));
});

test("a check that fails for another reason than the minimum is no floor", () => {
  assert.match(refused(stub(codexRepo(), OTHER, "other")), /^ERROR \[NO_WAIT_FLOOR\] /);
});

test("the scratch home a fix is judged in is removed afterwards", () => {
  const c = codexRepo();
  const tmp = path.join(c.fixture.dir, "tmp");
  const log = path.join(c.fixture.dir, "homes.log");
  fs.mkdirSync(tmp);
  const logs = stub(c, `#!/bin/sh\necho "$CODEX_HOME" >> "${log}"\necho "multi_agent_v2  stable  false"`, "logs");
  refused({ ...logs, env: { ...logs.env, TMPDIR: tmp } });
  assert.ok(fs.readFileSync(log, "utf8").split("\n").some((home) => home.startsWith(tmp + path.sep)), "no scratch home under TMPDIR");
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test("a codex that is not there is named with the way to point at it", () => {
  const cmd = path.join(os.tmpdir(), "no-such-dir", "codex");
  assert.equal(refused(codexRepo({ codex: cmd })), R5(cmd));
});

test("a Claude host never runs codex", () => {
  const c = stub(codexRepo(), "#!/bin/sh\nexit 3", "exit3");
  assert.equal(frontier(c).code, 0);
  assert.equal(frontier(c, ARGS).code, 2);
});

test("a Codex tree outside git asks codex there", () => {
  const c = stub(codexRepo(), undefined, "holds");
  const plain = path.join(c.fixture.dir, "plain");
  fs.cpSync(c.fixture.root, plain, { recursive: true, filter: (src) => path.basename(src) !== ".git" });
  const result = run(c.fixture, ["frontier", "alpha", "--tree", plain, ...ARGS], { cwd: plain, env: c.env });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready a-one /m);
});
