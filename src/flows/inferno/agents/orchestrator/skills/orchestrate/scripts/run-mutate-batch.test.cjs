const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

// `run.cjs mutate --batch` plants every mistake of a review. The Rust ones share one build: each
// sits in its file behind a switch that is off by default, a control run proves the tests green
// with every switch off, and then each test runs with its own switch on. A fake toolchain stands in
// for cargo here: it counts a build whenever the sources changed, so a run that rebuilt shows.

const { RUN, batchTree, builds, env, fakeTest, git, journalOf, runBatch, runs, source } = require("./run-mutate-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

const LIB = [
  "pub fn alpha() -> usize { ONE + TEN }",
  "pub fn beta() -> usize { 2 }",
  "pub fn gamma() -> usize { 3 }",
  "pub const fn delta() -> usize { 4 }",
  "pub fn omega() -> usize { let mut total = 0; total += 4; total }",
  "#[doc = \"alpha\"] pub fn attr() -> usize { 6 }",
  "",
].join("\n");

const read = (f, rel = "src/lib.rs") => fs.readFileSync(path.join(f.root, rel), "utf8");

function entry(f, criterion, line, find, replace, name, expected) {
  return { criterion, file: "src/lib.rs", line, find, replace, test: fakeTest(f, name, expected) };
}

test("Rust entries share one build: one control run per test, then each switch alone, and nothing rebuilds", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const result = runBatch(f, [
    entry(f, "AC1", 1, "ONE", "TWO", "alpha", "ONE + TEN"),
    entry(f, "AC2", 1, "TEN", "SIX", "alpha", "ONE + TEN"),
    entry(f, "AC3", 2, "2", "8", "beta", "usize"),
    entry(f, "AC4", 3, "3", "9", "gamma", "{ 3 }"),
  ], { json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(builds(f), 1, "one build for four Rust entries");
  assert.equal(result.payload.builds, 1);
  const order = runs(f).map((run) => [run.name, run.on]);
  assert.deepEqual(order, [["alpha", null], ["beta", null], ["gamma", null], ["alpha", "1"], ["alpha", "2"], ["beta", "3"], ["gamma", "4"]]);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [true, true, false, true]);
  assert.equal(read(f), LIB);
  assert.equal(git(f.root, "status", "--porcelain"), "");
  assert.equal(journalOf(f), null);
});

test("the human output names each entry, the builds used, and lines ready to paste under mutants", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const result = runBatch(f, [
    entry(f, "AC1", 1, "ONE", "TWO", "alpha", "ONE + TEN"),
    entry(f, "AC3", 2, "2", "8", "beta", "usize"),
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught yes \| src\/lib\.rs:1 \| AC1$/m);
  assert.match(result.out, /^caught no \| src\/lib\.rs:2 \| AC3$/m);
  assert.match(result.out, /^1 build for 2 Rust entries/m);
  const pasted = result.out.slice(result.out.indexOf("  - criterion"));
  const { parseYaml } = require("./run-yaml.cjs");
  assert.deepEqual(parseYaml(`mutants:\n${pasted}`).mutants, [
    { criterion: "AC1", test: fakeTest(f, "alpha", "ONE + TEN"), caught: "yes" },
    { criterion: "AC3", test: fakeTest(f, "beta", "usize"), caught: "no" },
  ]);
});

test("expression and statement switches are written into the file, off by default", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const result = runBatch(f, [
    entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"),
    entry(f, "AC2", 5, "total += 4;", "", "omega", "total += 4;"),
  ], { json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const built = source(f, 1).split("\n");
  assert.match(built[2], /^pub fn gamma\(\) -> usize \{ \(if \{ static INFERNO_SWITCH: ::std::sync::OnceLock<bool> = .*"1".* \} \{ 9 \} else \{ 3 \}\) \}$/);
  assert.match(built[4], /total = 0; if \{ static INFERNO_SWITCH: .*"2".* \} \{ {2}\} else \{ total \+= 4; \} total \}$/);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [true, true]);
});

test("a YAML batch reads the same as a JSON one", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const yaml = `- criterion: AC1\n  file: src/lib.rs\n  line: 3\n  find: "3"\n  replace: "9"\n  test: '${fakeTest(f, "gamma", "{ 3 }")}'\n`;
  const result = runBatch(f, yaml, { json: true, file: path.join(f.dir, "batch.yaml") });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.payload.entries[0].caught, true);
});

test("a switch that does not compile goes to a build of its own, and the rest still share one", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const result = runBatch(f, [
    entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"),
    entry(f, "AC2", 4, "4", "5", "delta", "{ 4 }"),
  ], { json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(builds(f), 3, "a failed control, a green one, and delta's own build");
  assert.equal(result.payload.builds, 3);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["classic", true]]);
  assert.match(result.payload.entries[1].own, /switch did not compile/);
  assert.equal(read(f), LIB);
});

test("a compile error on a line no entry holds moves that file's switches to their own builds", (t) => {
  const f = batchTree(t, { "src/lib.rs": "pub fn gamma() -> usize { 3 } // scoped\n// no entry here\npub fn beta() -> usize { 2 }\n" });
  const result = runBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "3", replace: "9", test: fakeTest(f, "gamma", "{ 3 }") },
    { criterion: "AC2", file: "src/lib.rs", line: 3, find: "2", replace: "8", test: fakeTest(f, "beta", "{ 2 }") },
  ], { json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["classic", true], ["classic", true]]);
  assert.equal(builds(f), 3, "the failed control, then one build each");
});

test("a mistake that builds neither way reads no verdict: did not build, and it is never pasted as caught", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const result = runBatch(f, [
    entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"),
    entry(f, "AC2", 2, "2", "nocompile", "beta", "{ 2 }"),
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^no verdict: did not build \| src\/lib\.rs:2 \| AC2/m);
  assert.doesNotMatch(result.out, /criterion: "AC2"/);
  assert.match(result.out, /criterion: "AC1"/);
  assert.equal(read(f), LIB);
});

test("an entry on an attribute line takes its own build in place, beside the shared one", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const result = runBatch(f, [
    entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"),
    entry(f, "AC2", 6, "\"alpha\"", "\"omega\"", "attr", "\"alpha\""),
  ], { json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(builds(f), 2);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["classic", true]]);
  assert.match(result.payload.entries[1].own, /attribute/);
  const human = runBatch(f, [entry(f, "AC2", 6, "\"alpha\"", "\"omega\"", "attr", "\"alpha\"")]);
  assert.match(human.out, /^caught yes \| src\/lib\.rs:6 \| AC2 \| own build: on an attribute line$/m);
});

test("a test red with every switch off stops the batch with no verdict at all, and every file is restored", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB, "src/m.js": "module.exports = 1;\n" });
  const result = runBatch(f, [
    entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"),
    entry(f, "AC2", 2, "2", "8", "beta", "{ 99 }"),
    { criterion: "AC3", file: "src/m.js", line: 1, find: "1", replace: "2", test: "true" },
  ]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /red with every switch off/);
  assert.doesNotMatch(result.out, /caught (yes|no)/);
  assert.equal(runs(f).filter((run) => run.on !== null).length, 0);
  assert.equal(read(f), LIB);
  assert.equal(git(f.root, "status", "--porcelain"), "");
  assert.equal(journalOf(f), null);
});

test("a JavaScript entry runs its test once in place beside the Rust ones", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB, "src/m.js": "module.exports = 1;\n" });
  const check = "node -e \"process.exit(require('./src/m.js') === 1 ? 0 : 1)\"";
  const result = runBatch(f, [
    entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"),
    { criterion: "AC2", file: "src/m.js", line: 1, find: "1", replace: "2", test: check },
    { criterion: "AC3", file: "src/m.js", line: 1, find: "1", replace: "(if 1 { 2 })", test: check },
  ], { json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.payload.builds, 1);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["classic", true], ["classic", null]]);
  const human = runBatch(f, [{ criterion: "AC3", file: "src/m.js", line: 1, find: "1", replace: "(if 1 { 2 })", test: check }]);
  assert.match(human.out, /^no verdict: did not parse \| src\/m\.js:1 \| AC3$/m);
  assert.equal(read(f, "src/m.js"), "module.exports = 1;\n");
});

test("a dirty tree is refused and nothing is touched, while the batch file itself may sit in the tree", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const entries = [entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }")];
  const inside = runBatch(f, entries, { file: path.join(f.root, "batch.json") });
  assert.equal(inside.code, 0, inside.out + inside.err);
  writeFile(path.join(f.root, "src/other.rs"), "x\n");
  const dirty = runBatch(f, entries);
  assert.equal(dirty.code, 2, dirty.out + dirty.err);
  assert.match(dirty.err, /DIRTY.*src\/other\.rs/);
  assert.equal(read(f), LIB);
});

test("an entry whose find is not on its line exactly once is refused before anything is written", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  for (const [find, why] of [["9", /occurs 0 times/], ["total", /occurs 3 times/]]) {
    const result = runBatch(f, [entry(f, "AC1", 3, "3", "9", "gamma", "{ 3 }"), entry(f, "AC2", 5, find, "x", "omega", "usize")]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, why);
    assert.match(result.err, /entry 2/);
  }
  assert.equal(builds(f), 0);
  assert.equal(journalOf(f), null);
  for (const bad of [[{ criterion: "AC1", file: "src/lib.rs", line: 3, find: "3", replace: "9\n" }], [], { find: "3" }]) {
    const result = runBatch(f, bad);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_(BATCH|TARGET)/);
  }
});

const TWO_FILES = { "src/a.rs": "pub fn alpha() -> usize { 1 }\n", "src/b.rs": "pub fn beta() -> usize { 2 }\n" };

/** Start a batch over two files whose control run holds; resolves once both switches are written. */
async function heldBatch(t, f) {
  const file = path.join(f.dir, "batch.json");
  writeFile(file, JSON.stringify([
    { criterion: "AC1", file: "src/a.rs", line: 1, find: "1", replace: "7", test: fakeTest(f, "alpha", "hold") },
    { criterion: "AC2", file: "src/b.rs", line: 1, find: "2", replace: "8", test: fakeTest(f, "beta", "hold") },
  ]));
  const child = spawn(process.execPath, [RUN, "mutate", "--tree", f.root, "--batch", file], { cwd: f.root, env: env(f), stdio: "ignore" });
  t.after(() => child.kill("SIGKILL"));
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  const both = () => ["src/a.rs", "src/b.rs"].every((rel) => fs.readFileSync(path.join(f.root, rel), "utf8") !== TWO_FILES[rel]);
  for (let i = 0; i < 400 && !(both() && runs(f).length > 0); i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.ok(both(), "the switches never landed");
  return { child, done, release: () => writeFile(path.join(f.state, "release"), "") };
}

test("a second mutate refuses while a live batch holds its switches", async (t) => {
  const f = batchTree(t, { ...TWO_FILES, "src/m.js": "module.exports = 1;\n" });
  const run = await heldBatch(t, f);
  const second = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.root, "--file", "src/m.js", "--line", "1",
    "--replace", "module.exports = 2;", "--test", "true"], { cwd: f.root, encoding: "utf8", env: env(f) });
  run.release();
  await run.done;
  assert.equal(second.status, 2, second.stdout + second.stderr);
  assert.match(second.stderr, /another mutate \(pid \d+\) is running on src\/a\.rs, src\/b\.rs/);
  for (const rel of Object.keys(TWO_FILES)) assert.equal(read(f, rel), TWO_FILES[rel]);
});

test("a batch killed outright is restored in every file it switched, byte for byte, by the next mutate", async (t) => {
  const f = batchTree(t, TWO_FILES);
  const run = await heldBatch(t, f);
  run.child.kill("SIGKILL");
  await run.done;
  run.release();
  assert.ok(journalOf(f), "the killed batch leaves its journal");
  const next = runBatch(f, [{ criterion: "AC1", file: "src/a.rs", line: 1, find: "1", replace: "7", test: fakeTest(f, "alpha", "{ 1 }") }]);
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /^restored src\/a\.rs from an interrupted mutate$/m);
  assert.match(next.out, /^restored src\/b\.rs from an interrupted mutate$/m);
  assert.match(next.out, /^caught yes \| src\/a\.rs:1 \| AC1$/m);
  for (const rel of Object.keys(TWO_FILES)) assert.equal(read(f, rel), TWO_FILES[rel]);
  assert.equal(journalOf(f), null);
});

test("a killed batch's leftover under a later edit is refused in that file, the other file is restored, and the journal keeps the refused one", async (t) => {
  const f = batchTree(t, TWO_FILES);
  const run = await heldBatch(t, f);
  run.child.kill("SIGKILL");
  await run.done;
  run.release();
  const edited = `${read(f, "src/b.rs")}// later\n`;
  writeFile(path.join(f.root, "src/b.rs"), edited);
  const next = runBatch(f, [{ criterion: "AC1", file: "src/a.rs", line: 1, find: "1", replace: "7", test: "true" }]);
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(next.err, /MUTATE_LEFTOVER.*src\/b\.rs/);
  assert.match(next.err, /restored src\/a\.rs/);
  assert.equal(read(f, "src/a.rs"), TWO_FILES["src/a.rs"]);
  assert.equal(read(f, "src/b.rs"), edited);
  const kept = JSON.parse(fs.readFileSync(journalOf(f), "utf8"));
  assert.deepEqual(kept.files.map((entry) => entry.file), ["src/b.rs"]);
});

// A signal that reaches node but not the test it runs (a kill of the node pid) is held until the
// restore, and the batch starts no run after it: every entry still to run reads not run.
for (const [shape, files, entries, first] of [
  ["switched Rust entries", { "src/lib.rs": "pub fn a() -> usize { 1 }\npub fn b() -> usize { 2 }\npub fn c() -> usize { 3 }\n" },
    [[1, "1"], [2, "2"], [3, "3"]].map(([line, find]) => ({ criterion: `AC${line}`, file: "src/lib.rs", line, find, replace: "9" })), "switch"],
  ["JavaScript entries in place", { "src/m.js": "module.exports = [1, 2, 3];\n" },
    ["1", "2", "3"].map((find, i) => ({ criterion: `AC${i + 1}`, file: "src/m.js", line: 1, find, replace: "9" })), "own"],
]) {
  test(`a SIGTERM to the batch during entry 1 of ${shape} stops it before entry 2, and every file is restored`, async (t) => {
    const f = batchTree(t, files);
    const marks = path.join(f.dir, "marks");
    const sleeper = `echo "\${INFERNO_MUTANT:-off}" >> ${JSON.stringify(marks)}; sleep 1`;
    const file = path.join(f.dir, "batch.json");
    writeFile(file, JSON.stringify(entries.map((e) => ({ ...e, test: sleeper }))));
    const child = spawn(process.execPath, [RUN, "mutate", "--tree", f.root, "--batch", file], { cwd: f.root, env: env(f), stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => child.kill("SIGKILL"));
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
    const entryOne = first === "switch" ? "1" : "off";
    const seen = () => (fs.existsSync(marks) ? fs.readFileSync(marks, "utf8").split("\n").filter(Boolean) : []);
    for (let i = 0; i < 400 && !seen().includes(entryOne); i += 1) await new Promise((r) => setTimeout(r, 25));
    assert.ok(seen().includes(entryOne), "entry 1 never started");
    child.kill("SIGTERM");
    const code = await done;
    assert.equal(code, 2, out);
    assert.match(out, /SIGTERM/);
    assert.match(out, /^no verdict: not run \| \S+ \| AC2$/m);
    assert.match(out, /^no verdict: not run \| \S+ \| AC3$/m);
    const logs = fs.readdirSync(path.join(f.cache), { recursive: true }).filter((p) => p.endsWith(".log"));
    assert.ok(logs.some((p) => p.endsWith(`-${first}-1.log`)), logs.join(", "));
    assert.ok(!logs.some((p) => /-(switch|own)-[23]\.log$/.test(p)), logs.join(", "));
    for (const [rel, body] of Object.entries(files)) assert.equal(read(f, rel), body);
    assert.equal(journalOf(f), null);
  });
}
