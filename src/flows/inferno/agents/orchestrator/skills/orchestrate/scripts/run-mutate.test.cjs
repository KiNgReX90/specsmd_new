const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

// `run.cjs mutate` breaks one line, runs the test that should notice, and always puts the
// line back: after a pass, a failure, a signal, and after a run killed outright.

const RUN = path.join(__dirname, "run.cjs");
const FILE = "src/m.js";
const ORIGINAL = "module.exports = 1;\n";
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");
const { untilMutant } = require("./review-fixture.cjs");
const CHECK = "node -e \"process.exit(require('./src/m.js') === 1 ? 0 : 1)\"";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(t) {
  const dir = tempDir("inferno-mutate-");
  t.after(() => {
    spawnSync("chmod", ["-R", "u+w", dir]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const tree = path.join(dir, "app");
  fs.mkdirSync(path.join(tree, "src"), { recursive: true });
  git(tree, "init", "-q", "-b", "main");
  git(tree, "config", "user.email", "test@example.com");
  git(tree, "config", "user.name", "Test");
  writeFile(path.join(tree, FILE), ORIGINAL);
  git(tree, "add", "-A");
  git(tree, "commit", "-qm", "init");
  return { tree, cache: path.join(dir, "cache"), dir };
}

const args = (f, test, extra = []) =>
  [RUN, "mutate", "--tree", f.tree, "--file", FILE, "--line", "1", "--replace", "module.exports = 2;", "--test", test, ...extra];
// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const env = (f) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache });

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
  writeFile(path.join(f.tree, "src/other.js"), "x\n");
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

/** Start a mutate on line 1 of `file` whose test holds until `release` exists; resolves once the mutant is in place. */
// A hold also ends once its fixture dir is gone, so a hold that only starts after its test let go never outlives the test.
async function held(f, file = FILE, replace = "module.exports = 2;") {
  const release = path.join(f.dir, "release");
  const landing = untilMutant(path.join(f.tree, file), replace);
  const child = spawn(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", file, "--line", "1", "--replace", replace,
    "--test", `until [ -f ${release} ] || [ ! -d ${f.dir} ]; do sleep 0.05; done; true`], { cwd: f.tree, env: env(f), stdio: "ignore" });
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  assert.ok(await landing, "the mutant never landed");
  return { child, done, release: () => writeFile(release, "") };
}

/** A mutate killed outright: its mutant and its journal stay behind. */
async function killed(f, file, replace) {
  const run = await held(f, file, replace);
  run.child.kill("SIGKILL");
  await run.done;
  run.release();
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
  writeFile(path.join(f.tree, "src/n.js"), "module.exports = 3;\n");
  git(f.tree, "add", "-A");
  git(f.tree, "commit", "-qm", "n");
  const release = path.join(f.dir, "release");
  const holdThenCheck = `until [ -f ${release} ] || [ ! -d ${f.dir} ]; do sleep 0.05; done; ${CHECK}`;
  const child = spawn(process.execPath, args(f, holdThenCheck), { cwd: f.tree, env: env(f), stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  const done = new Promise((resolve) => child.on("close", resolve));
  for (let i = 0; i < 200 && content(f) === ORIGINAL; i += 1) await new Promise((r) => setTimeout(r, 25));
  const second = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", "src/n.js", "--line", "1",
    "--replace", "module.exports = 4;", "--test", "true"], { cwd: f.tree, encoding: "utf8", env: env(f) });
  writeFile(release, "");
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
    writeFile(journal, JSON.stringify({ ...JSON.parse(fs.readFileSync(journal, "utf8")), ...(await owner(t)) }));
    assert.notEqual(content(f), ORIGINAL);
    const next = mutate(f, CHECK);
    assert.equal(next.code, 0, next.out + next.err);
    assert.match(next.out, /restored src\/m\.js/);
    assert.match(next.out, /^caught yes$/m);
    assert.equal(content(f), ORIGINAL);
  });
}

// Recovery writes a file only when it is byte for byte what the mutate wrote, and never looks
// for the mutant by its text. Anything else is refused with the journal kept, so a person puts
// the original back where the mutant stands.
const LEFTOVER = /MUTATE_LEFTOVER.*line 1 of src\/m\.js as "module\.exports = 2;" in place of "module\.exports = 1;".*delete \S+mutate-journal\.json/;

for (const [name, edit] of [
  ["a line added above it", (text) => `// first\n${text}`],
  ["the mutant line edited away", () => "module.exports = 7;\n"],
  ["the mutant line twice", (text) => `${text}${text}`],
]) {
  test(`a leftover mutant under a later edit, ${name}, is refused and nothing is written`, async (t) => {
    const f = fixture(t);
    await killed(f);
    const edited = edit(content(f));
    writeFile(path.join(f.tree, FILE), edited);
    const next = mutate(f, CHECK);
    assert.equal(next.code, 2, next.out + next.err);
    assert.match(next.err, LEFTOVER);
    assert.equal(content(f), edited);
    assert.ok(journalOf(f), "the journal is kept");
  });
}

test("a line nobody mutated is never rewritten: A,B,C mutated to C,B,C and edited to Z,B,C stays Z,B,C", async (t) => {
  const f = fixture(t);
  writeFile(path.join(f.tree, "src/p.txt"), "A\nB\nC\n");
  git(f.tree, "add", "-A");
  git(f.tree, "commit", "-qm", "p");
  await killed(f, "src/p.txt", "C");
  writeFile(path.join(f.tree, "src/p.txt"), "Z\nB\nC\n");
  const next = mutate(f, CHECK);
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(next.err, /MUTATE_LEFTOVER.*src\/p\.txt/);
  assert.equal(fs.readFileSync(path.join(f.tree, "src/p.txt"), "utf8"), "Z\nB\nC\n");
  assert.ok(journalOf(f), "the journal is kept");
});

test("a run killed after its restore leaves a file that already holds its original, and the journal goes", async (t) => {
  const f = fixture(t);
  await killed(f);
  git(f.tree, "checkout", "--", FILE);
  const next = mutate(f, CHECK);
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /^src\/m\.js already holds its original/m);
  assert.match(next.out, /^caught yes$/m);
  assert.equal(content(f), ORIGINAL);
  assert.equal(journalOf(f), null);
});

test("a journal without the line, the texts and the original's hash is refused, and the mutant stays", async (t) => {
  const f = fixture(t);
  await killed(f);
  const journal = journalOf(f);
  const { line, original, replace, before, ...rest } = JSON.parse(fs.readFileSync(journal, "utf8"));
  writeFile(journal, JSON.stringify(rest));
  const next = mutate(f, CHECK);
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(next.err, /MUTATE_LEFTOVER.*src\/m\.js/);
  assert.equal(content(f), "module.exports = 2;\n");
  assert.ok(journalOf(f), "the journal is kept");
});

// A red run is a caught mutant only when the test ran. A build that failed or a file that does not
// parse never reached the test, and a run something killed never finished it.
test("a Rust mutant whose build fails reads no verdict: did not build, never caught yes", (t) => {
  const f = fixture(t);
  writeFile(path.join(f.tree, "src/lib.rs"), "pub fn a() -> u32 { 1 }\n");
  git(f.tree, "add", "-A");
  git(f.tree, "commit", "-qm", "rust");
  const cargo = "printf 'error[E0308]: mismatched types\\n --> src/lib.rs:1:21\\n\\nerror: could not compile `x` (lib) due to 1 previous error\\n'; exit 101";
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", "src/lib.rs", "--line", "1",
    "--replace", "pub fn a() -> u32 { \"1\" }", "--test", cargo], { cwd: f.tree, encoding: "utf8", env: env(f) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^no verdict: did not build$/m);
  assert.doesNotMatch(result.stdout, /caught yes/);
  assert.equal(fs.readFileSync(path.join(f.tree, "src/lib.rs"), "utf8"), "pub fn a() -> u32 { 1 }\n");
});

test("a JavaScript mutant that does not parse reads no verdict: did not parse", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", FILE, "--line", "1",
    "--replace", "module.exports = (if 1 { 2 });", "--test", CHECK], { cwd: f.tree, encoding: "utf8", env: env(f) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^no verdict: did not parse$/m);
  assert.equal(content(f), ORIGINAL);
});

test("a SyntaxError the mutant throws while it runs is still caught", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", FILE, "--line", "1",
    "--replace", "module.exports = JSON.parse('{bad');", "--test", CHECK], { cwd: f.tree, encoding: "utf8", env: env(f) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^caught yes$/m);
});

test("a test something killed with exit 137 reads no verdict and exits 2", (t) => {
  const f = fixture(t);
  const result = mutate(f, "sh -c 'kill -9 $$'; exit $?");
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^no verdict: killed \(exit 137\)/m);
  assert.equal(content(f), ORIGINAL);
});
