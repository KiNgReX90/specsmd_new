const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const DEFAULT = '.specs-inferno/config.yaml';
const CODEX = '.specs-inferno/config.codex.yaml';
const scoped = 'node proof.cjs scoped';
const whole = 'node proof.cjs whole';
const red = 'node proof.cjs red';

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  fs.writeFileSync(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function config(commands = [scoped, whole], integrate = [], scopes = { [scoped]: ['src/**'] }) {
  const list = (values) => values.length ? `\n${values.map((value) => `    - ${value}`).join('\n')}` : ' []';
  return `delivery:\n  base_branch: main\nverification:\n  finalize:${list(commands)}\n  integrate:${list(integrate)}\n` +
    `  finalize_scopes: ${Object.keys(scopes).length ? '\n' + Object.entries(scopes).map(([command, patterns]) =>
      `    "${command}": ${JSON.stringify(patterns)}`).join('\n') : '{}'}\n`;
}

function fixture(t, source = config()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-gate-proof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, 'app');
  fs.mkdirSync(tree);
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  write(tree, '.gitignore', '.runs\n');
  write(tree, 'src/input.txt', 'one\n');
  write(tree, 'scripts/fix.txt', 'red\n');
  write(tree, DEFAULT, source);
  write(tree, 'proof.cjs', `const fs = require('node:fs');
const name = process.argv[2];
fs.appendFileSync('.runs', name + '\\n');
if (name.startsWith('red') && fs.readFileSync('scripts/fix.txt', 'utf8').trim() === 'red') process.exit(1);
`);
  commit(tree);
  git(tree, 'checkout', '-qb', 'intent');
  return { tree, cache: path.join(dir, 'cache') };
}

function commit(tree) {
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', 'fixture');
}

function run(f, ...args) {
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function ran(f) {
  return fs.readFileSync(path.join(f.tree, '.runs'), 'utf8').trim().split('\n');
}

function passed(result) {
  assert.equal(result.code, 0, result.out + result.err);
}

test('gate reuses every successful command without writing a whole-tree marker', (t) => {
  const f = fixture(t);
  assert.equal(run(f, 'green').code, 3, 'green must be 3 before the gate has run');
  const first = run(f, 'gate', '--json');
  passed(first);
  const gateResult = JSON.parse(first.out);
  assert.equal('marker' in gateResult, false);
  assert.equal(fs.existsSync(path.join(f.cache, 'specsmd-inferno', 'app', 'green')), false);
  assert.deepEqual(ran(f), ['scoped', 'whole']);
  const second = run(f, 'gate');
  passed(second);
  assert.match(second.out, /GREEN \d+s node proof.cjs scoped \(unchanged since [^)]+\)/);
  assert.match(second.out, /GREEN \d+s node proof.cjs whole \(unchanged since [^)]+\)/);
  assert.deepEqual(ran(f), ['scoped', 'whole']);
  const verdict = run(f, 'green', '--json');
  passed(verdict);
  const greenResult = JSON.parse(verdict.out);
  assert.equal('marker' in greenResult, false);
  assert.match(greenResult.hash, /^[0-9a-f]+$/);
  assert.equal(greenResult.hash, gateResult.hash);
  assert.equal(fs.existsSync(path.join(f.cache, 'specsmd-inferno', 'app', 'green')), false);
});

test('a fix after a red reruns the red and unscoped commands and reuses unaffected scopes', (t) => {
  const f = fixture(t, config([scoped, whole, red]));
  assert.equal(run(f, 'gate').code, 2);
  assert.equal(run(f, 'green').code, 3);
  write(f.tree, 'scripts/fix.txt', 'green\n');
  commit(f.tree);
  const retry = run(f, 'gate');
  passed(retry);
  assert.match(retry.out, /GREEN \d+s node proof.cjs scoped/);
  assert.deepEqual(ran(f), ['scoped', 'whole', 'red', 'whole', 'red']);
  passed(run(f, 'green'));
});

test('a change inside a scope reruns that command and ledger changes preserve its proof', (t) => {
  const f = fixture(t);
  passed(run(f, 'gate'));
  write(f.tree, 'src/input.txt', 'two\n');
  commit(f.tree);
  assert.equal(run(f, 'green').code, 3);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['scoped', 'whole', 'scoped', 'whole']);
  write(f.tree, '.specs-inferno/note.md', 'bookkeeping\n');
  commit(f.tree);
  passed(run(f, 'green'));
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['scoped', 'whole', 'scoped', 'whole']);
});

test('integrate leaves reusable proofs only for the commands that ran successfully', (t) => {
  const f = fixture(t, config([scoped, whole, red], [scoped, whole]));
  write(f.tree, 'src/input.txt', 'two\n');
  write(f.tree, 'scripts/fix.txt', 'green\n');
  commit(f.tree);
  passed(run(f, 'integrate'));
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['scoped', 'whole']);
  assert.equal(run(f, 'green').code, 3);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['scoped', 'whole', 'red']);
});

test('integrate never turns an unexecuted scoped command into a proof', (t) => {
  const f = fixture(t, config([scoped, whole], [scoped, whole]));
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['whole']);
  assert.equal(run(f, 'green').code, 3);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['whole', 'scoped']);
});

test('gate and green read the selected host list and keep equal commands separate by config', (t) => {
  const f = fixture(t);
  write(f.tree, CODEX, config([scoped]));
  commit(f.tree);
  passed(run(f, 'gate', '--config', CODEX));
  assert.deepEqual(ran(f), ['scoped']);
  passed(run(f, 'green', '--config', CODEX));
  assert.equal(run(f, 'green').code, 3);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['scoped', 'scoped', 'whole']);
  passed(run(f, 'gate', '--config', path.join(f.tree, CODEX)));
  assert.deepEqual(ran(f), ['scoped', 'scoped', 'whole']);
});

test('changing the selected host scopes invalidates its previous proof', (t) => {
  const f = fixture(t);
  write(f.tree, CODEX, config([scoped]));
  commit(f.tree);
  passed(run(f, 'gate', '--config', CODEX));
  write(f.tree, CODEX, config([scoped], [], { [scoped]: ['scripts/**'] }));
  commit(f.tree);
  assert.equal(run(f, 'green', '--config', CODEX).code, 3);
  passed(run(f, 'gate', '--config', CODEX));
  assert.deepEqual(ran(f), ['scoped', 'scoped']);
});

test('a missing explicit config never falls back to the default host', (t) => {
  const f = fixture(t);
  const result = run(f, 'gate', '--config', CODEX);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /config\.codex\.yaml/);
  assert.ok(!fs.existsSync(path.join(f.tree, '.runs')));
});

test('detached gates preserve their selected host configuration', (t) => {
  const f = fixture(t);
  write(f.tree, CODEX, config([scoped]));
  commit(f.tree);
  passed(run(f, 'gate', '--detach', '--config', CODEX));
  const result = run(f, 'gate', '--wait', '--minutes', '0.5', '--config', CODEX);
  passed(result);
  assert.deepEqual(ran(f), ['scoped']);
  passed(run(f, 'green', '--config', CODEX));
  assert.equal(run(f, 'green').code, 3);
});

test('gate refuses a command that edits its inputs without committing and mints no proof', (t) => {
  const command = 'node proof.cjs mutate';
  const f = fixture(t, config([command], [], { [command]: ['src/**'] }));
  fs.appendFileSync(path.join(f.tree, 'proof.cjs'), "if (name === 'mutate') fs.writeFileSync('src/input.txt', 'moved\\n');\n");
  commit(f.tree);
  const result = run(f, 'gate');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /changed while the gate ran/);
  commit(f.tree);
  assert.equal(run(f, 'green').code, 3);
});

test('corrupt command proofs make green fail and force the commands to rerun', (t) => {
  const f = fixture(t);
  passed(run(f, 'gate'));
  const dir = path.join(f.cache, 'specsmd-inferno', 'app', 'green-commands');
  for (const file of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, file), '{broken');
  assert.equal(run(f, 'green').code, 3);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['scoped', 'whole', 'scoped', 'whole']);
});

test('integrate full browser runs satisfy only the exact finalize command they executed', (t) => {
  const source = config([whole], []) + `  integrate_e2e:\n    command: node proof.cjs browser\n    full: ${whole}\n    full_when: ["src/**"]\n    map: {}\n`;
  const f = fixture(t, source);
  write(f.tree, 'src/input.txt', 'two\n');
  commit(f.tree);
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['whole']);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['whole']);
});

test('an unrelated scoped command stays green when only the docs scope changes', (t) => {
  const docs = 'node proof.cjs docs';
  const f = fixture(t, config([scoped, docs], [], { [scoped]: ['src/**'], [docs]: ['docs/**'] }));
  passed(run(f, 'gate'));
  write(f.tree, 'docs/readme.md', 'new\n');
  commit(f.tree);
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['scoped', 'docs', 'docs']);
});

test('waiting with a different host config cannot return another host gate result', (t) => {
  const f = fixture(t);
  write(f.tree, CODEX, config([scoped]));
  commit(f.tree);
  passed(run(f, 'gate', '--detach', '--config', CODEX));
  const other = run(f, 'gate', '--wait', '--minutes', '0.5');
  const own = run(f, 'gate', '--wait', '--minutes', '0.5', '--config', CODEX);
  passed(own);
  assert.equal(other.code, 2, other.out + other.err);
  assert.match(other.err, /config/);
});

test('gate and integrate read command lists from the config after folding the base', (t) => {
  const added = 'node proof.cjs added';
  for (const step of ['gate', 'integrate']) {
    const f = fixture(t, config([whole], [whole]));
    git(f.tree, 'checkout', '-q', 'main');
    write(f.tree, DEFAULT, config([added], [added]));
    commit(f.tree);
    git(f.tree, 'checkout', '-q', 'intent');
    const result = run(f, step);
    passed(result);
    assert.deepEqual(ran(f), ['added']);
  }
});

// Stopping at the first failing command cost one orchestrator round trip and one builder
// correction per failure: an item that broke three commands paid three integrate runs and three
// followups to learn what one run could have said. Every command runs and one red names them all.
test('integrate runs every command and names every failure in one red result', (t) => {
  const f = fixture(t, config([whole], [red, whole, 'node proof.cjs red-two']));
  const result = run(f, 'integrate');
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(ran(f), ['red', 'whole', 'red-two']);
  assert.match(result.out, /FAIL \d+s node proof\.cjs red ->/);
  assert.match(result.out, /PASS \d+s node proof\.cjs whole/);
  assert.match(result.out, /FAIL \d+s node proof\.cjs red-two ->/);
  assert.match(result.out, /2 of 3 integrate command\(s\) failed/);
});
