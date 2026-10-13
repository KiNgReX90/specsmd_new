const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const { reviewBefore } = require('./review-fixture.cjs');

function tempdir(prefix) {
  return tempDir(prefix);
}

function hashTree(t) {
  const dir = tempdir('inferno-lib-scope-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  lib.git(dir, ['config', 'user.email', 'test@example.com']);
  lib.git(dir, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, '.specs-inferno'));
  writeFile(path.join(dir, 'src/input.txt'), 'one\n');
  writeFile(path.join(dir, 'outside.txt'), 'outside\n');
  writeFile(path.join(dir, '.specs-inferno/state.yaml'), 'ledger\n');
  hashCommit(dir);
  return dir;
}

function hashCommit(dir) {
  lib.git(dir, ['add', '-A']);
  lib.git(dir, ['commit', '-qm', 'fixture']);
}

test('scope hashes follow committed and dirty contents and ignore ledger and out-of-scope edits', (t) => {
  const dir = hashTree(t);
  const hash = () => proofs.scopeHash(dir, ['src/**']);
  const before = hash();
  writeFile(path.join(dir, 'outside.txt'), 'moved\n');
  writeFile(path.join(dir, '.specs-inferno/state.yaml'), 'moved\n');
  assert.equal(hash(), before);
  writeFile(path.join(dir, 'src/input.txt'), 'two\n');
  const dirty = hash();
  assert.notEqual(dirty, before);
  hashCommit(dir);
  assert.equal(hash(), dirty);
  const all = proofs.scopeHash(dir);
  writeFile(path.join(dir, 'outside.txt'), 'again\n');
  assert.notEqual(proofs.scopeHash(dir), all);
});

test('scope hashes include additions, deletions, renames, modes and symlink targets', (t) => {
  const dir = hashTree(t);
  const hash = () => proofs.scopeHash(dir, ['src/**']);
  let before = hash();
  const input = path.join(dir, 'src/input.txt');
  fs.chmodSync(input, 0o755);
  assert.notEqual(hash(), before);
  before = hash();
  hashCommit(dir);
  assert.equal(hash(), before);
  const odd = path.join(dir, 'src/caf\u00e9\nname.txt');
  fs.renameSync(input, odd);
  assert.notEqual(hash(), before);
  before = hash();
  hashCommit(dir);
  assert.equal(hash(), before);
  fs.rmSync(odd);
  assert.notEqual(hash(), before);
  before = hash();
  hashCommit(dir);
  assert.equal(hash(), before);
  fs.symlinkSync('../outside.txt', path.join(dir, 'src/link'));
  assert.notEqual(hash(), before);
  before = hash();
  hashCommit(dir);
  assert.equal(hash(), before);
  fs.rmSync(path.join(dir, 'src/link'));
  fs.symlinkSync('../missing.txt', path.join(dir, 'src/link'));
  assert.notEqual(hash(), before);
});

test('an exact scope hashes the literal paths only, never a same-named file in another folder', (t) => {
  const dir = hashTree(t);
  writeFile(path.join(dir, 'src/outside.txt'), 'nested\n');
  hashCommit(dir);
  const exact = () => proofs.scopeHash(dir, ['outside.txt'], { exact: true });
  const before = exact();
  writeFile(path.join(dir, 'src/outside.txt'), 'moved\n');
  assert.equal(exact(), before);
  writeFile(path.join(dir, 'outside.txt'), 'moved\n');
  assert.notEqual(exact(), before);
});

// Per-command proofs driven through run.cjs: config, inputs and --force.
const RUN = path.join(__dirname, 'run.cjs');
const CONFIG = '.specs-inferno/config.yaml';
const OTHER = '.specs-inferno/other.yaml';
const COMMANDS = ['echo ran >> .runs/source', 'echo ran >> .runs/docs', 'echo ran >> .runs/all'];

function write(root, file, body) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFile(path.join(root, file), body);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commit(root) {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'fixture');
}

function config(commands = COMMANDS) {
  return `verification:
  finalize:
${commands.map((command) => `    - ${command}`).join('\n')}
  finalize_scopes:
    "${commands[0]}": ["src/**"]
    "${commands[1]}": ["docs/**"]
delivery:
  base_branch: main
`;
}

function repo(t, body = config()) {
  const dir = tempDir('inferno-proof-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  write(root, '.gitignore', '.runs/\n');
  write(root, '.runs/ready', '');
  write(root, 'src/input.txt', 'source\n');
  write(root, 'docs/input.txt', 'docs\n');
  write(root, 'outside.txt', 'outside\n');
  write(root, '.specs-inferno/state.yaml', 'ledger\n');
  write(root, CONFIG, body);
  commit(root);
  // A real host gates on an intent branch, after a clean intent review of the tree it gates.
  git(root, 'checkout', '-qb', 'inferno-intent/demo-00000000T000000Z');
  return { root, cache: path.join(dir, 'cache') };
}

function run(fixture, ...args) {
  reviewBefore(args, fixture.root);
  // CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: fixture.cache },
  });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

function verdict(fixture, command, expected, ...args) {
  const result = run(fixture, command, ...args, '--json');
  assert.equal(result.code, expected, result.out + result.err);
  return JSON.parse(result.out);
}

function counts(fixture) {
  return ['source', 'docs', 'all'].map((name) => {
    const file = path.join(fixture.root, '.runs', name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').length : 0;
  });
}

test('a red command reruns alone while successful commands keep their proofs', (t) => {
  const commands = [...COMMANDS];
  commands[2] += '; if [ ! -f .runs/allow ]; then exit 1; fi';
  const fixture = repo(t, config(commands));
  verdict(fixture, 'gate', 2);
  verdict(fixture, 'green', 3);
  assert.deepEqual(counts(fixture), [1, 1, 1]);
  verdict(fixture, 'gate', 2);
  assert.deepEqual(counts(fixture), [1, 1, 2]);
  write(fixture.root, '.runs/allow', '');
  verdict(fixture, 'gate', 0);
  assert.deepEqual(counts(fixture), [1, 1, 3]);
  verdict(fixture, 'green', 0);
  const reused = run(fixture, 'gate');
  assert.equal(reused.code, 0, reused.out + reused.err);
  assert.match(reused.out, /GREEN .*unchanged/);
  assert.deepEqual(counts(fixture), [1, 1, 3]);
});

test('scope edits invalidate only matching commands and unlisted commands', (t) => {
  const fixture = repo(t);
  verdict(fixture, 'gate', 0);
  write(fixture.root, 'src/input.txt', 'changed\n');
  commit(fixture.root);
  const stale = verdict(fixture, 'green', 3);
  assert.deepEqual(stale.missing, [COMMANDS[0], COMMANDS[2]]);
  verdict(fixture, 'gate', 0);
  assert.deepEqual(counts(fixture), [2, 1, 2]);
  write(fixture.root, 'outside.txt', 'changed\n');
  commit(fixture.root);
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [COMMANDS[2]]);
  verdict(fixture, 'gate', 0);
  assert.deepEqual(counts(fixture), [2, 1, 3]);
  write(fixture.root, '.specs-inferno/state.yaml', 'bookkeeping\n');
  commit(fixture.root);
  verdict(fixture, 'green', 0);
  verdict(fixture, 'gate', 0);
  assert.deepEqual(counts(fixture), [2, 1, 3]);
});

test('--force reruns all commands and a forced failure revokes its proof', (t) => {
  const commands = [...COMMANDS];
  commands[2] += '; if [ -f .runs/fail ]; then exit 1; fi';
  const fixture = repo(t, config(commands));
  verdict(fixture, 'gate', 0);
  verdict(fixture, 'gate', 0, '--force');
  assert.deepEqual(counts(fixture), [2, 2, 2]);
  write(fixture.root, '.runs/fail', '');
  verdict(fixture, 'gate', 2, '--force');
  assert.deepEqual(counts(fixture), [3, 3, 3]);
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [commands[2]]);
});

test('a forced gate that never finishes leaves no old proof standing for the command it was running', (t) => {
  const commands = [...COMMANDS];
  commands[2] += '; if [ -f .runs/kill ]; then kill -9 $PPID; fi';
  const fixture = repo(t, config(commands));
  verdict(fixture, 'gate', 0);
  write(fixture.root, '.runs/kill', '');
  assert.notEqual(run(fixture, 'gate', '--force').code, 0);
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [commands[2]]);
});

test('--config keeps independent proofs and resolves relative to --tree', (t) => {
  const fixture = repo(t);
  write(fixture.root, OTHER, config());
  commit(fixture.root);
  verdict(fixture, 'gate', 0);
  verdict(fixture, 'green', 3, '--config', OTHER);
  const outside = { ...fixture, root: path.dirname(fixture.root) };
  verdict(outside, 'gate', 0, '--tree', fixture.root, '--config', OTHER);
  assert.deepEqual(counts(fixture), [2, 2, 2]);
  verdict(fixture, 'green', 0, '--config', OTHER);
  verdict(fixture, 'green', 0);
  verdict(fixture, 'gate', 0, '--config', `./${OTHER}`);
  assert.deepEqual(counts(fixture), [2, 2, 2]);
  const changed = [...COMMANDS];
  changed[0] += '; touch .runs/new-command';
  write(fixture.root, OTHER, config(changed));
  commit(fixture.root);
  assert.deepEqual(verdict(fixture, 'green', 3, '--config', OTHER).missing, [changed[0]]);
  verdict(fixture, 'green', 0);
  verdict(fixture, 'gate', 0, '--config', OTHER);
  assert.deepEqual(counts(fixture), [3, 2, 2]);
  assert.ok(fs.existsSync(path.join(fixture.root, '.runs/new-command')));
});

test('scope changes and corrupt or deleted records require a fresh proof', (t) => {
  const fixture = repo(t);
  verdict(fixture, 'gate', 0);
  write(fixture.root, CONFIG, config().replace('["src/**"]', '["src/**", "outside.txt"]'));
  commit(fixture.root);
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [COMMANDS[0]]);
  verdict(fixture, 'gate', 0);
  const dir = path.join(fixture.cache, 'specsmd-inferno', 'app', 'green-commands');
  const files = fs.readdirSync(dir);
  const doc = files.find((file) => JSON.parse(fs.readFileSync(path.join(dir, file))).command === COMMANDS[1]);
  writeFile(path.join(dir, doc), '{}');
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [COMMANDS[1]]);
  verdict(fixture, 'gate', 0);
  fs.rmSync(path.join(dir, doc));
  verdict(fixture, 'green', 3);
  verdict(fixture, 'gate', 0);
  assert.deepEqual(counts(fixture), [2, 3, 1]);
  assert.equal(fs.existsSync(path.join(dir, '..', 'green')), false);
});

test('successful commands cannot prove inputs they changed while running', (t) => {
  const commands = [...COMMANDS];
  commands[0] += '; echo changed >> src/input.txt';
  const fixture = repo(t, config(commands));
  const result = verdict(fixture, 'gate', 2);
  assert.equal(result.results[0].moved, true);
  commit(fixture.root);
  verdict(fixture, 'green', 3);
});

test('explicit missing configs fail and usage keeps config, base and force options', (t) => {
  const fixture = repo(t);
  for (const command of ['gate', 'green']) {
    const result = run(fixture, command, '--config', '.specs-inferno/missing.yaml');
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
  }
  const usage = run(fixture, 'help').out;
  for (const command of ['gate', 'green', 'ship']) {
    assert.match(usage, new RegExp(`node run\\.cjs ${command}[^\\n]*\\[--config <file>\\]`));
  }
  assert.match(usage, /\[--base <branch>\]/);
  assert.match(usage, /--force/);
});

test('detached gates preserve --config and --force through --wait', (t) => {
  const fixture = repo(t);
  write(fixture.root, OTHER, config());
  commit(fixture.root);
  for (const force of [[], ['--force']]) {
    verdict(fixture, 'gate', 0, '--config', OTHER, '--detach', ...force);
    verdict(fixture, 'gate', 0, '--config', OTHER, '--wait', '--minutes', '0.5');
  }
  assert.deepEqual(counts(fixture), [2, 2, 2]);
  verdict(fixture, 'green', 0, '--config', OTHER);
  verdict(fixture, 'green', 3);
});

test('scope hashes agree before and after committing content and path changes', (t) => {
  const { scopeHash } = require('./run-proofs.cjs');
  const fixture = repo(t);
  const root = fixture.root;
  const hash = () => scopeHash(root, ['src/**']);
  const initial = hash();
  write(root, 'outside.txt', 'changed\n');
  write(root, '.specs-inferno/state.yaml', 'changed\n');
  assert.equal(hash(), initial);
  commit(root);
  const operations = [
    () => write(root, 'src/input.txt', 'changed\n'),
    () => fs.chmodSync(path.join(root, 'src/input.txt'), 0o755),
    () => fs.renameSync(path.join(root, 'src/input.txt'), path.join(root, 'src/caf\u00e9\nname.txt')),
    () => fs.rmSync(path.join(root, 'src/caf\u00e9\nname.txt')),
    () => fs.symlinkSync('../outside.txt', path.join(root, 'src/link')),
    () => {
      fs.rmSync(path.join(root, 'src/link'));
      fs.symlinkSync('../missing.txt', path.join(root, 'src/link'));
    },
    () => {
      fs.renameSync(path.join(root, 'src/link'), path.join(root, 'docs/link'));
      git(root, 'add', '-A');
    },
  ];
  for (const [index, operation] of operations.entries()) {
    const before = hash();
    operation();
    const dirty = hash();
    assert.notEqual(dirty, before, `operation ${index}`);
    commit(root);
    assert.equal(hash(), dirty);
  }
});

test('later commands changing earlier inputs prevent a green gate verdict', (t) => {
  const commands = [...COMMANDS];
  commands[1] += '; echo changed >> src/input.txt';
  const fixture = repo(t, config(commands));
  const result = verdict(fixture, 'gate', 2);
  assert.equal(result.moved, true);
  assert.equal(result.results.every((entry) => entry.result === 'pass'), true);
  commit(fixture.root);
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [commands[0]]);
});

test('a config change during a command prevents a green gate verdict', (t) => {
  const commands = [...COMMANDS];
  commands[2] += `; sed -i 's#src/[*][*]#outside.txt#' ${CONFIG}`;
  const fixture = repo(t, config(commands));
  const result = verdict(fixture, 'gate', 2);
  assert.equal(result.moved, true, JSON.stringify(result));
  commit(fixture.root);
  assert.deepEqual(verdict(fixture, 'green', 3).missing, [commands[0]]);
});

test('legacy whole-tree markers cannot satisfy command proofs', (t) => {
  const fixture = repo(t);
  write(fixture.cache, `specsmd-inferno/app/green/${lib.codeTreeHash(fixture.root)}`, 'old marker\n');
  verdict(fixture, 'green', 3);
  verdict(fixture, 'gate', 0);
  assert.deepEqual(counts(fixture), [1, 1, 1]);
});
