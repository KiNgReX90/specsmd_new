'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');

// The flow's suites run in every host's gate, so a temp dir a suite leaves behind leaks on
// every gate run on every machine. Tests and fixtures make their dirs through test-temp.cjs,
// which removes them when the process exits. What a killed process leaves, the next load removes.

const FLOW = path.resolve(__dirname, '../../../../..');
const HELPER = path.join(__dirname, 'test-temp.cjs');
// Built in two halves so this file never matches its own rule.
const DIRECT = new RegExp('\\bmk' + 'dtemp(?:Sync)?\\b');
const SCRIPTS = path.relative(FLOW, __dirname);

const isTestCode = (file) => file.endsWith('.test.cjs') || file.endsWith('-fixture.cjs');

/** Every line of test code in a {file: source} map that makes a temp dir without the helper. */
function offenders(files) {
  const found = [];
  for (const [file, source] of Object.entries(files)) {
    if (!isTestCode(file)) continue;
    source.split('\n').forEach((line, at) => {
      if (DIRECT.test(line)) found.push(`${file}:${at + 1}`);
    });
  }
  return found;
}

function flowSources() {
  const files = {};
  for (const rel of fs.readdirSync(FLOW, { recursive: true, encoding: 'utf8' })) {
    if (rel.endsWith('.cjs')) files[rel] = fs.readFileSync(path.join(FLOW, rel), 'utf8');
  }
  return files;
}

function refusal(found) {
  return `${found.join('\n')}\n` +
    'These lines make a temp dir directly, and the dir outlives the run. Make it with\n' +
    `  const { tempDir } = require('<relative path to ${path.relative(FLOW, HELPER)}>');\n` +
    "  const dir = tempDir('inferno-<name>-');\n" +
    'so it is removed when the process ends.';
}

test('the rule catches every direct temp dir call in tests and fixtures, and only there', () => {
  const call = 'mk' + 'dtemp';
  const lines = [
    `const dir = fs.${call}Sync(path.join(os.tmpdir(), 'x-'));`,
    `fs.${call}(prefix, (error, dir) => done(dir));`,
    `const dir = await fs.promises.${call}(prefix);`,
    `const { ${call} } = require('node:fs/promises');`,
    `const make = util.promisify(fs.${call});`,
  ];
  const source = `${lines.join('\n')}\nconst dir = tempDir('x-');\n`;
  const all = lines.map((_, at) => at + 1);
  assert.deepEqual(offenders({ 'a.test.cjs': source, 'b-fixture.cjs': source, 'run-x.cjs': source }), [
    ...all.map((at) => `a.test.cjs:${at}`),
    ...all.map((at) => `b-fixture.cjs:${at}`),
  ]);
});

test('every flow test and fixture makes its temp dirs through test-temp.cjs', () => {
  const files = flowSources();
  // The guard reaches only what it collects, so a test file and the fixtures most dirs come from are named here.
  for (const name of ['test-temp.test.cjs', 'review-fixture.cjs', 'state-transition-fixture.cjs']) {
    assert.ok(path.join(SCRIPTS, name) in files, `${name} is not collected from ${FLOW}`);
  }
  const found = offenders(files);
  assert.deepEqual(found, [], refusal(found));
});

// A child that makes one dir in a private temp root and then ends the way `end` says.
const child = (end) => `const { tempDir } = require(${JSON.stringify(HELPER)}); tempDir('inferno-child-'); ${end}`;

function privateRoot() {
  const tmp = tempDir('inferno-root-');
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  delete env.NODE_TEST_CONTEXT;
  return { tmp, env };
}

for (const [name, end, status] of [
  ['a passing run', '', 0],
  ['a failing test', "require('node:test')('fails', () => { throw new Error('red'); });", 1],
  ['an uncaught throw', "throw new Error('red');", 1],
  ['an early exit', 'process.exit(3);', 3],
]) {
  test(`the dirs go when the process ends on ${name}, and it still exits ${status}`, () => {
    const { tmp, env } = privateRoot();
    const run = spawnSync(process.execPath, ['-e', child(end)], { env, encoding: 'utf8' });
    assert.equal(run.status, status, run.stderr);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
}

const asRoot = process.getuid?.() === 0;
test('a dir the exit hook cannot remove never turns a passing run red', { skip: asRoot && 'root ignores the read-only root' }, (t) => {
  const { tmp, env } = privateRoot();
  t.after(() => fs.chmodSync(tmp, 0o700));
  // The child takes write access off the temp root after making its dir, so its own root cannot be removed.
  const run = spawnSync(process.execPath, ['-e', child("require('node:fs').chmodSync(process.env.TMPDIR, 0o500);")], {
    env,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readdirSync(tmp).length, 1);
});

// A child for a signal case. It is killed outright after the case, so a handler that keeps it alive fails the case
// instead of holding the run open.
function start(t, end, env) {
  const proc = spawn(process.execPath, ['-e', child(end)], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => {
    proc.kill('SIGKILL');
    proc.stdin.destroy();
  });
  return proc;
}

const ready = (proc) => new Promise((resolve) => proc.stdout.once('data', resolve));

/** How the process ended, or 'still running' when it outlives the wait. */
function ending(proc, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('still running'), ms);
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

const CASE = { timeout: 10_000 };

// A flow suite spends most of its time blocked in a synchronous call, where a JS signal handler cannot run.
// The grandchild says ready once the child is blocked on it, and waits on the case's stdin, so it ends with
// the case instead of outliving it.
const GRANDCHILD = "process.stdout.write('ready'); process.stdin.resume();";
const BLOCKED = "require('node:child_process')" +
  `.spawnSync(process.execPath, ['-e', ${JSON.stringify(GRANDCHILD)}], { stdio: ['inherit', 'inherit', 'ignore'] });`;

/** Loads the helper in a fresh process on the temp root `env` names, as the next suite on a machine does. */
const nextLoad = (env) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(HELPER)});`], { env });

// The scan's timeout sends SIGTERM to the suite alone, and a terminal sends SIGINT or SIGHUP. Each ends a blocked
// process at once, by that signal. The process leaves its own root, and the next load removes it.
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
  test(`a blocked process ends at once on ${signal}, and the next load removes its root`, CASE, async (t) => {
    const { tmp, env } = privateRoot();
    const proc = start(t, BLOCKED, env);
    await ready(proc);
    proc.kill(signal);
    assert.deepEqual(await ending(proc, 5_000), { code: null, signal });
    assert.deepEqual(fs.readdirSync(tmp), [`inferno-tests-${proc.pid}`]);
    assert.equal(nextLoad(env).status, 0);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
}

test('the load removes a root whose process is gone, and leaves a live root and every other entry', () => {
  const { tmp, env } = privateRoot();
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  // Pid 1 is alive under another user, so the check sees EPERM there unless the run is root. A pid past the
  // range process.kill takes makes it throw a TypeError, which must never break the load.
  const kept = [`inferno-tests-${process.pid}`, 'inferno-tests-1', 'inferno-tests-99999999999'];
  kept.push(`inferno-tests-${gone}-x`, `x-inferno-tests-${gone}`);
  for (const name of [...kept, `inferno-tests-${gone}`]) fs.mkdirSync(path.join(tmp, name));
  assert.equal(nextLoad(env).status, 0);
  assert.deepEqual(fs.readdirSync(tmp).sort(), kept.sort());
});
