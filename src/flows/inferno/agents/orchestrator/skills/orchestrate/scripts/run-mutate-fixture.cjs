'use strict';
// A committed tree and a fake Rust toolchain for the batch mutate tests.
// The fake reads every source under src/ as a build would. It counts a build whenever the sources
// changed since the last one, refuses a line the way a compiler refuses it, and answers a test from
// the line its function sits on, with only the switch INFERNO_MUTANT names turned on. Its hold
// also ends once the state dir is gone, so it never outlives its test.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');

const RUN = path.join(__dirname, 'run.cjs');

// The fake's own source. It overwrites a file by removing it and appending, so this fixture holds
// no direct write.
const FAKE = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [name, expected] = process.argv.slice(2);
const state = process.env.FAKE_RUST_STATE;
const src = path.join(process.cwd(), 'src');
const files = fs.readdirSync(src).filter((f) => f.endsWith('.rs')).sort();
const bodies = files.map((f) => [f, fs.readFileSync(path.join(src, f), 'utf8')]);
const hash = crypto.createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
const built = path.join(state, 'built');
const last = fs.existsSync(built) ? fs.readFileSync(built, 'utf8') : '';
if (last !== hash) {
  const count = fs.existsSync(path.join(state, 'builds')) ? fs.readFileSync(path.join(state, 'builds'), 'utf8').split('\n').length - 1 : 0;
  fs.appendFileSync(path.join(state, 'builds'), hash + '\n');
  for (const [f, body] of bodies) fs.appendFileSync(path.join(state, 'source-' + (count + 1) + '-' + f), body);
  console.log('   Compiling fixture v0.1.0');
  const errors = [];
  for (const [f, body] of bodies) {
    body.split('\n').forEach((line, i) => {
      const switched = line.includes('INFERNO_MUTANT');
      if (line.includes('nocompile') || (switched && line.includes('const '))) errors.push([f, i + 1, line]);
      if (switched && line.includes('scoped')) errors.push([f, i + 2, '']);
    });
  }
  if (errors.length > 0) {
    for (const [f, n, line] of errors) {
      console.log('error[E0015]: cannot call non-const fn in constant functions\n --> src/' + f + ':' + n + ':5\n  |\n' + n + ' | ' + line + '\n  |     ^^^\n');
    }
    console.log('error: could not compile ' + '\x60fixture\x60 (lib test) due to ' + errors.length + ' previous errors');
    process.exit(101);
  }
  fs.rmSync(built, { force: true });
  fs.appendFileSync(built, hash);
}
const on = process.env.INFERNO_MUTANT || null;
const SWITCH = /\(?if \{ static INFERNO_SWITCH[^{}]*?v == "(\d+)"[^{}]*\} \{ (.*?) \} else \{ (.*?) \}\)?/g;
const lines = bodies.flatMap(([, body]) => body.split('\n'));
const line = lines.find((entry) => entry.includes('fn ' + name + '(')) || '';
const effective = line.replace(SWITCH, (all, k, broken, kept) => (k === on ? broken : kept));
fs.appendFileSync(path.join(state, 'runs'), JSON.stringify({ name, on, effective }) + '\n');
if (expected === 'hold') {
  while (!fs.existsSync(path.join(state, 'release')) && fs.existsSync(state)) spawnSleep();
}
function spawnSleep() { require('child_process').spawnSync('sleep', ['0.05']); }
if (effective.includes(expected) || expected === 'hold') {
  console.log('test result: ok. 1 passed');
  process.exit(0);
}
console.log('test ' + name + ' ... FAILED');
process.exit(101);
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A committed tree holding `files` ({rel: body}), with a cache dir, a state dir and the fake toolchain. */
function batchTree(t, files) {
  const dir = tempDir('inferno-mutate-batch-');
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', dir]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, 'app');
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFile(path.join(root, rel), body);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  const state = path.join(dir, 'state');
  fs.mkdirSync(state, { recursive: true });
  const fake = path.join(dir, 'fake-rust.cjs');
  writeFile(fake, FAKE);
  return { root, dir, state, fake, cache: path.join(dir, 'cache') };
}

/** The test command the fake answers: green while the line of `fn name(` holds `expected`. */
const fakeTest = (f, name, expected) => `node ${JSON.stringify(f.fake)} ${name} ${JSON.stringify(expected)}`;

// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const env = (f) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache, FAKE_RUST_STATE: f.state });

/** Write the batch as JSON (or as the text given) outside the tree and run it; `--json` adds the payload. */
function runBatch(f, entries, { json = false, file = path.join(f.dir, 'batch.json') } = {}) {
  writeFile(file, typeof entries === 'string' ? entries : JSON.stringify(entries));
  const args = [RUN, 'mutate', '--tree', f.root, '--batch', file, ...(json ? ['--json'] : [])];
  const result = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8', env: env(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, payload: json && result.status !== 1 ? safeJson(result.stdout) : null };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

/** How many builds the fake counted, and the runs it answered in order. */
const builds = (f) => (fs.existsSync(path.join(f.state, 'builds')) ? fs.readFileSync(path.join(f.state, 'builds'), 'utf8').split('\n').filter(Boolean).length : 0);
const runs = (f) => (fs.existsSync(path.join(f.state, 'runs')) ? fs.readFileSync(path.join(f.state, 'runs'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const source = (f, n, file = 'lib.rs') => fs.readFileSync(path.join(f.state, `source-${n}-${file}`), 'utf8');

/** The journal a run left under the tree's cache, or null. */
function journalOf(f) {
  const rel = fs.existsSync(f.cache) && fs.readdirSync(f.cache, { recursive: true }).find((p) => p.endsWith('mutate-journal.json'));
  return rel ? path.join(f.cache, rel) : null;
}

module.exports = { RUN, batchTree, builds, env, fakeTest, git, journalOf, runBatch, runs, source };
