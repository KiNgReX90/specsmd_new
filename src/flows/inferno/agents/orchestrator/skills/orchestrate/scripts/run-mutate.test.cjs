const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

// `run.cjs mutate` breaks one line, runs the test that should notice, and always puts the
// line back: after a pass, a failure, a signal, and after a run killed outright.

const RUN = path.join(__dirname, "run.cjs");
const FILE = "src/m.js";
const ORIGINAL = "module.exports = 1;\n";
const CHECK = "node -e \"process.exit(require('./src/m.js') === 1 ? 0 : 1)\"";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-mutate-"));
  t.after(() => {
    spawnSync("chmod", ["-R", "u+w", dir]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const tree = path.join(dir, "app");
  fs.mkdirSync(path.join(tree, "src"), { recursive: true });
  git(tree, "init", "-q", "-b", "main");
  git(tree, "config", "user.email", "test@example.com");
  git(tree, "config", "user.name", "Test");
  fs.writeFileSync(path.join(tree, FILE), ORIGINAL);
  git(tree, "add", "-A");
  git(tree, "commit", "-qm", "init");
  return { tree, cache: path.join(dir, "cache"), dir };
}

const args = (f, test, extra = []) =>
  [RUN, "mutate", "--tree", f.tree, "--file", FILE, "--line", "1", "--replace", "module.exports = 2;", "--test", test, ...extra];
const env = (f) => ({ ...process.env, XDG_CACHE_HOME: f.cache });

function mutate(f, test) {
  const result = spawnSync(process.execPath, args(f, test), { cwd: f.tree, encoding: "utf8", env: env(f) });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const content = (f) => fs.readFileSync(path.join(f.tree, FILE), "utf8");

test("a test that notices the broken line reads caught yes, and the line is restored", (t) => {
  const f = fixture(t);
  const result = mutate(f, CHECK);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught yes$/m);
  assert.equal(content(f), ORIGINAL);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
});

test("a test that misses it reads caught no and exits 0", (t) => {
  const f = fixture(t);
  const result = mutate(f, "true");
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught no$/m);
  assert.equal(content(f), ORIGINAL);
});

test("mutate refuses a dirty tree and touches nothing", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.tree, "src/other.js"), "x\n");
  const result = mutate(f, CHECK);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /dirty|uncommitted/);
  assert.equal(content(f), ORIGINAL);
});

test("mutate refuses a line that does not change, a line past the end and an untracked file", (t) => {
  const f = fixture(t);
  const same = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", FILE, "--line", "1",
    "--replace", "module.exports = 1;", "--test", "true"], { encoding: "utf8", env: env(f) });
  assert.equal(same.status, 2, same.stderr);
  const past = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", FILE, "--line", "9",
    "--replace", "x", "--test", "true"], { encoding: "utf8", env: env(f) });
  assert.equal(past.status, 2, past.stderr);
  const outside = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", "src/none.js", "--line", "1",
    "--replace", "x", "--test", "true"], { encoding: "utf8", env: env(f) });
  assert.equal(outside.status, 2, outside.stderr);
});

/** Start a mutate whose test holds until `release` exists; resolves once the mutant is in place. */
async function held(f) {
  const release = path.join(f.dir, "release");
  const child = spawn(process.execPath, args(f, `until [ -f ${release} ]; do sleep 0.05; done; true`),
    { cwd: f.tree, env: env(f), stdio: "ignore" });
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  for (let i = 0; i < 200 && content(f) === ORIGINAL; i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.notEqual(content(f), ORIGINAL, "the mutant never landed");
  return { child, done, release: () => fs.writeFileSync(release, "") };
}

test("a signal during the test still restores the line", async (t) => {
  const f = fixture(t);
  const run = await held(f);
  run.child.kill("SIGTERM");
  run.release();
  await run.done;
  assert.equal(content(f), ORIGINAL);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
});

test("a run killed outright is restored by the next mutate before it starts", async (t) => {
  const f = fixture(t);
  const run = await held(f);
  run.child.kill("SIGKILL");
  await run.done;
  run.release();
  assert.notEqual(content(f), ORIGINAL);
  const next = mutate(f, CHECK);
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /restored src\/m\.js/);
  assert.match(next.out, /^caught yes$/m);
  assert.equal(content(f), ORIGINAL);
});

test("a restore that fails exits 2 and names the file", (t) => {
  const f = fixture(t);
  const result = mutate(f, "chmod a-w src/m.js src");
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out + result.err, /restore.*src\/m\.js|src\/m\.js.*restore/);
});

test("a second mutate refuses while a live run holds its mutant, and the live run keeps its verdict", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.tree, "src/n.js"), "module.exports = 3;\n");
  git(f.tree, "add", "-A");
  git(f.tree, "commit", "-qm", "n");
  const release = path.join(f.dir, "release");
  const holdThenCheck = `until [ -f ${release} ]; do sleep 0.05; done; ${CHECK}`;
  const child = spawn(process.execPath, args(f, holdThenCheck), { cwd: f.tree, env: env(f), stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  const done = new Promise((resolve) => child.on("close", resolve));
  for (let i = 0; i < 200 && content(f) === ORIGINAL; i += 1) await new Promise((r) => setTimeout(r, 25));
  const second = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", "src/n.js", "--line", "1",
    "--replace", "module.exports = 4;", "--test", "true"], { cwd: f.tree, encoding: "utf8", env: env(f) });
  fs.writeFileSync(release, "");
  await done;
  assert.equal(second.status, 2, second.stdout + second.stderr);
  assert.match(second.stderr, /another mutate/);
  assert.match(second.stderr, /if no mutate is running, delete \S+mutate-journal\.json/);
  assert.match(out, /^caught yes$/m);
  assert.equal(content(f), ORIGINAL);
});

/** The journal a run writes under the fixture's cache, or null. */
function journalOf(f) {
  const rel = fs.existsSync(f.cache) && fs.readdirSync(f.cache, { recursive: true }).find((p) => p.endsWith("mutate-journal.json"));
  return rel ? path.join(f.cache, rel) : null;
}

/** Fields 3 (state) and 22 (start time) of /proc/<pid>/stat; the name in field 2 may hold spaces. */
function procStat(pid) {
  const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return { state: fields[0], start: fields[19] };
}

/** A zombie: the child of a shell that exec'd into a sleep, which never reaps it. */
async function zombie(t) {
  const parent = spawn("sh", ["-c", "sleep 0.2 & echo $!; exec sleep 30"], { stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => parent.kill("SIGKILL"));
  const pid = Number(await new Promise((resolve) => parent.stdout.once("data", resolve)));
  for (let i = 0; i < 200 && procStat(pid).state !== "Z"; i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.equal(procStat(pid).state, "Z", "the zombie never formed");
  return { pid, start: procStat(pid).start };
}

for (const [name, owner] of [
  ["an unrelated live process", (t) => {
    const other = spawn("sleep", ["30"], { stdio: "ignore" });
    t.after(() => other.kill("SIGKILL"));
    return { pid: other.pid };
  }],
  ["a zombie with the same start time", zombie],
]) {
  test(`a killed run's journal whose pid now names ${name} is restored, and the mutate runs`, { skip: !fs.existsSync("/proc/self/stat") }, async (t) => {
    const f = fixture(t);
    const run = await held(f);
    run.child.kill("SIGKILL");
    await run.done;
    run.release();
    const journal = journalOf(f);
    fs.writeFileSync(journal, JSON.stringify({ ...JSON.parse(fs.readFileSync(journal, "utf8")), ...(await owner(t)) }));
    assert.notEqual(content(f), ORIGINAL);
    const next = mutate(f, CHECK);
    assert.equal(next.code, 0, next.out + next.err);
    assert.match(next.out, /restored src\/m\.js/);
    assert.match(next.out, /^caught yes$/m);
    assert.equal(content(f), ORIGINAL);
  });
}

// A file edited after its mutate was killed: the mutant line is found again by its text, never
// guessed at, and the journal goes only with a line that says what happened to it.
for (const [name, edit, after, said, kept] of [
  ["a line added above it", (text) => `// first\n${text}`, "// first\nmodule.exports = 1;\n",
    /restored line 2 of src\/m\.js from an interrupted mutate/, false],
  ["the mutant line edited away", () => "module.exports = 7;\n", "module.exports = 7;\n",
    /src\/m\.js changed after an interrupted mutate and no longer holds its mutant "module\.exports = 2;"/, false],
  ["the mutant line twice", (text) => `${text}${text}`, "module.exports = 2;\nmodule.exports = 2;\n",
    /src\/m\.js .*lines 1, 2.*"module\.exports = 1;".*mutate-journal\.json/, true],
]) {
  test(`a leftover mutant under a later edit, ${name}, is handled out loud`, async (t) => {
    const f = fixture(t);
    const run = await held(f);
    run.child.kill("SIGKILL");
    await run.done;
    run.release();
    fs.writeFileSync(path.join(f.tree, FILE), edit(content(f)));
    const next = mutate(f, CHECK);
    assert.equal(next.code, 2, next.out + next.err);
    assert.match(next.err, said);
    assert.equal(content(f), after);
    assert.equal(journalOf(f) !== null, kept);
  });
}
