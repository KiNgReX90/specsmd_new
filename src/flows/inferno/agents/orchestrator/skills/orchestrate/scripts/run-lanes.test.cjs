const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const { reviewBefore } = require('./review-fixture.cjs');

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const DEFAULT = '.specs-inferno/config.yaml';
const whole = 'node proof.cjs whole';
const red = 'node proof.cjs red';

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  fs.writeFileSync(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(tree, message = 'change') {
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', message);
}

/** A config whose lanes are stub commands: `node lane.cjs <name> <exit code | wait>`. */
function config(lanes = { smoke: '0' }, finalize = [whole], scope = ['src/**']) {
  const blocks = Object.entries(lanes).map(([name, code]) =>
    `  ${name}:\n    command: node lane.cjs ${name} ${code}\n    scope: ${JSON.stringify(scope)}\n`).join('');
  return `delivery:\n  base_branch: main\nverification:\n  finalize:\n${finalize.map((c) => `    - ${c}\n`).join('')}${blocks}`;
}

function fixture(t, source = config()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-lanes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, 'app');
  const release = path.join(dir, 'release');
  fs.mkdirSync(tree);
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  write(tree, '.gitignore', '.runs\n.lane-runs\n');
  write(tree, 'src/input.txt', 'one\n');
  write(tree, 'docs/readme.txt', 'one\n');
  write(tree, DEFAULT, source.replace(/ wait\n/g, ` wait ${release}\n`));
  write(tree, 'proof.cjs', `const fs = require('node:fs');
fs.appendFileSync('.runs', process.argv[2] + '\\n');
if (process.argv[2] === 'red') process.exit(1);
`);
  write(tree, 'lane.cjs', `const fs = require('node:fs');
const [name, code, release] = process.argv.slice(2);
fs.appendFileSync('.lane-runs', name + '\\n');
if (code === 'wait') {
  while (!fs.existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  process.exit(0);
}
process.exit(Number(code));
`);
  commit(tree, 'fixture');
  git(tree, 'checkout', '-qb', BRANCH);
  return { tree, release, cache: path.join(dir, 'cache') };
}

function run(f, ...args) {
  reviewBefore(args, f.tree);
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function passed(result) {
  assert.equal(result.code, 0, result.out + result.err);
}

function laneRuns(f) {
  const file = path.join(f.tree, '.lane-runs');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
}

function touch(f, file = 'src/input.txt') {
  write(f.tree, file, `${Date.now()}-${Math.random()}\n`);
  commit(f.tree);
}

/** Detach the gate and wait it out; returns the wait's result. */
function gated(f, ...extra) {
  passed(run(f, 'gate', '--detach', ...extra));
  return run(f, 'gate', '--wait', '--minutes', '0.5', ...extra);
}

test('a lane starts only when the branch touched its scope', (t) => {
  const f = fixture(t);
  touch(f, 'docs/readme.txt');
  const started = run(f, 'gate', '--detach');
  passed(started);
  assert.match(started.out, /SKIP smoke \(no path in scope changed\)/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(laneRuns(f), []);
  touch(f);
  const again = run(f, 'gate', '--detach');
  passed(again);
  assert.match(again.out, /smoke lane started pid \d+/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(laneRuns(f), ['smoke']);
});

test('gate --wait exits 4 while a lane runs and 0 once the gate and every lane are green', (t) => {
  const f = fixture(t, config({ smoke: '0', windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const running = run(f, 'gate', '--wait', '--minutes', '0.03');
  assert.equal(running.code, 4, running.out + running.err);
  assert.match(running.out, /windows lane still running pid \d+/);
  fs.writeFileSync(f.release, '');
  const done = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(done);
  assert.match(done.out, /GREEN lane smoke/);
  assert.match(done.out, /GREEN lane windows/);
});

test('gate --wait exits 2 on a product red lane and on a red gate', (t) => {
  const product = fixture(t, config({ smoke: '10' }));
  touch(product);
  const result = gated(product);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke: product red \(exit 10\)/);

  const gateRed = fixture(t, config({ smoke: '0' }, [red]));
  touch(gateRed);
  const redGate = gated(gateRed);
  assert.equal(redGate.code, 2, redGate.out + redGate.err);
  assert.match(redGate.out, /FAIL \d+s node proof\.cjs red/);
});

test('exit 11 and any code other than 0 and 10 count as instrument red', (t) => {
  for (const code of ['11', '3']) {
    const f = fixture(t, config({ smoke: code }));
    touch(f);
    const result = gated(f);
    assert.equal(result.code, 3, result.out + result.err);
    assert.match(result.out, new RegExp(`INSTRUMENT RED lane smoke \\(exit ${code}\\)`));
    assert.match(result.out, /smoke --accept --harness-fix <sha>/);
    assert.doesNotMatch(result.out, /product red/);
  }
});

test('smoke --accept refuses a sha off the base branch and records one on it, which green accepts', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  touch(f);
  const onBranch = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', 'main');
  write(f.tree, 'harness.txt', 'fixed\n');
  commit(f.tree, 'harness fix');
  const fix = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  git(f.tree, 'merge', '-q', '--no-edit', 'main');
  gated(f);
  assert.equal(run(f, 'green').code, 3);

  const off = run(f, 'smoke', '--accept', '--harness-fix', onBranch);
  assert.equal(off.code, 2, off.out + off.err);
  assert.match(off.err, /not on main/);
  assert.equal(run(f, 'smoke', '--accept').code, 1);

  const accepted = run(f, 'smoke', '--accept', '--harness-fix', fix);
  passed(accepted);
  assert.match(accepted.out, new RegExp(`accepted smoke instrument red against harness fix ${fix.slice(0, 7)}`));
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  const verdict = run(f, 'green');
  passed(verdict);
  assert.match(verdict.out, /ACCEPTED smoke instrument red, harness fix [0-9a-f]{7}/);
});

test('smoke --accept refuses a tree whose smoke lane did not end instrument red', (t) => {
  const f = fixture(t, config({ smoke: '0' }));
  touch(f);
  passed(gated(f));
  const refused = run(f, 'smoke', '--accept', '--harness-fix', git(f.tree, 'rev-parse', 'main'));
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /no instrument red/);
});

test('green owes the smoke lane in scope, and skips it with no lane configured', (t) => {
  const f = fixture(t);
  touch(f);
  passed(run(f, 'gate'));
  const owed = run(f, 'green', '--json');
  assert.equal(owed.code, 3, owed.out + owed.err);
  assert.deepEqual(JSON.parse(owed.out).owed, ['smoke']);
  assert.match(run(f, 'green').out, /smoke owed: .*gate --detach/);
  passed(gated(f));
  passed(run(f, 'green'));

  const none = fixture(t, config({}));
  touch(none);
  passed(run(none, 'gate'));
  const skipped = run(none, 'green');
  passed(skipped);
  assert.match(skipped.out, /SKIP smoke \(no verification\.smoke in \.specs-inferno\/config\.yaml\)/);
});

test('a lane proof is keyed by the lane scope, so an edit outside it keeps the lane green', (t) => {
  const f = fixture(t);
  touch(f);
  passed(gated(f));
  touch(f, 'docs/readme.txt');
  const kept = run(f, 'gate', '--detach');
  passed(kept);
  assert.match(kept.out, /GREEN lane smoke \(unchanged since [^)]+\)/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  passed(run(f, 'green'));
  assert.deepEqual(laneRuns(f), ['smoke']);
  touch(f);
  passed(gated(f));
  assert.deepEqual(laneRuns(f), ['smoke', 'smoke']);
});

/** A harness fix committed on main and folded into the branch; returns its sha. */
function harnessFix(f) {
  git(f.tree, 'checkout', '-q', 'main');
  write(f.tree, 'harness.txt', `${Date.now()}\n`);
  commit(f.tree, 'harness fix');
  const fix = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  git(f.tree, 'merge', '-q', '--no-edit', 'main');
  return fix;
}

const acceptLine = (lane) => new RegExp(`^land the harness fix on main, then: node \\S+run\\.cjs ${lane} --accept --harness-fix <sha> --tree \\S+$`);

test('an unaccepted instrument red exits 3, owes its lane and prints the accept line last', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  touch(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out.trim().split('\n').pop(), acceptLine('smoke'));
  const json = run(f, 'gate', '--wait', '--minutes', '0.5', '--json');
  assert.equal(json.code, 3);
  assert.deepEqual(JSON.parse(json.out).owed, ['smoke']);
  assert.equal(JSON.parse(json.out).ok, false);
});

test('a windows instrument red is accepted by the windows --accept line gate --wait prints', (t) => {
  const f = fixture(t, config({ smoke: '0', windows: '11' }));
  touch(f);
  const fix = harnessFix(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out.trim().split('\n').pop(), acceptLine('windows'));
  const accepted = run(f, 'windows', '--accept', '--harness-fix', fix);
  passed(accepted);
  assert.match(accepted.out, new RegExp(`^accepted windows instrument red against harness fix ${fix.slice(0, 7)} for this tree$`, 'm'));
  assert.match(accepted.out, /^wait with: node \S+run\.cjs gate --wait --tree \S+$/m);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
});

test('each lane accepts only its own instrument red', (t) => {
  const f = fixture(t, config({ smoke: '11', windows: '11' }));
  touch(f);
  const fix = harnessFix(f);
  gated(f);
  passed(run(f, 'smoke', '--accept', '--harness-fix', fix));
  const result = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /INSTRUMENT RED lane windows/);
  assert.doesNotMatch(result.out, /INSTRUMENT RED lane smoke/);
  assert.match(result.out.trim().split('\n').pop(), acceptLine('windows'));
});
