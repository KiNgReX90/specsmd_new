const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const owner = require('./run-owner.cjs');

const LINUX = process.platform === 'linux' && fs.existsSync('/proc/self/stat');

function tempdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-lane-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function configs(t, project, host) {
  const dir = tempdir(t);
  fs.mkdirSync(path.join(dir, '.specs-inferno'));
  fs.writeFileSync(path.join(dir, '.specs-inferno', 'config.yaml'), project);
  if (host !== undefined) fs.writeFileSync(path.join(dir, '.specs-inferno', 'config.codex.yaml'), host);
  return dir;
}

const LANE = (name, command = 'npm run smoke') => `  ${name}:\n    command: ${command}\n    scope: ["src/**"]\n`;

test('a lane must be a map with one command and a scope list, and the refusal names the shape', (t) => {
  for (const body of [
    'verification:\n  smoke: npm run smoke\n',
    'verification:\n  smoke:\n    command: npm run smoke\n',
    'verification:\n  windows:\n    scope: ["src/**"]\n',
    'verification:\n  windows:\n    command: npm test\n    scope: src\n',
  ]) {
    const dir = configs(t, body);
    assert.throws(() => lib.readConfig(dir), (error) => {
      assert.equal(error.code, 'BAD_CONFIG');
      assert.match(error.message, /verification\.(smoke|windows) in .* must be a map with command, one shell command, and scope, a list of path globs/);
      return true;
    }, body);
  }
  const good = lib.readConfig(configs(t, `verification:\n${LANE('smoke')}${LANE('windows', 'npm run test:windows')}`));
  assert.deepEqual(good.verification.smoke, { command: 'npm run smoke', scope: ['src/**'] });
  assert.deepEqual(good.verification.windows, { command: 'npm run test:windows', scope: ['src/**'] });
});

test('a --config file inherits each lane it does not set, and keeps its own', (t) => {
  const project = `verification:\n  finalize:\n    - echo default\n${LANE('smoke')}${LANE('windows', 'npm run test:windows')}`;
  const inherited = lib.readConfig(configs(t, project, 'verification:\n  finalize:\n    - echo host\n'), '.specs-inferno/config.codex.yaml');
  assert.deepEqual(inherited.verification.finalize, ['echo host']);
  assert.equal(inherited.verification.smoke.command, 'npm run smoke');
  assert.equal(inherited.verification.windows.command, 'npm run test:windows');
  const own = lib.readConfig(configs(t, project, `verification:\n${LANE('smoke', 'npm run smoke:host')}`), '.specs-inferno/config.codex.yaml');
  assert.equal(own.verification.smoke.command, 'npm run smoke:host');
  assert.equal(own.verification.windows.command, 'npm run test:windows');
});

test('commandProof takes the scope it is keyed by, so a lane proof follows its own scope', (t) => {
  const dir = tempdir(t);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  lib.git(dir, ['config', 'user.email', 'test@example.com']);
  lib.git(dir, ['config', 'user.name', 'Test']);
  for (const file of ['src/a.txt', 'docs/b.txt']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'one\n');
  }
  lib.git(dir, ['add', '-A']);
  lib.git(dir, ['commit', '-qm', 'fixture']);
  const config = { verification: { finalize_scopes: { smoke: ['docs/**'] } } };
  const lane = () => proofs.commandProof(dir, config, null, 'smoke', ['src/**']);
  const finalize = () => proofs.commandProof(dir, config, null, 'smoke');
  const before = { lane: lane().file, finalize: finalize().file };
  assert.notEqual(before.lane, before.finalize);
  fs.writeFileSync(path.join(dir, 'docs/b.txt'), 'two\n');
  assert.equal(lane().file, before.lane);
  assert.notEqual(finalize().file, before.finalize);
  fs.writeFileSync(path.join(dir, 'src/a.txt'), 'two\n');
  assert.notEqual(lane().file, before.lane);
});

test('a live lane job owns the tree for select, like the gate job', { skip: !LINUX }, async (t) => {
  const dir = tempdir(t);
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  const branch = 'inferno-intent/x-20260910T000000Z';
  execFileSync('git', ['init', '-q', '-b', branch, root]);
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)', 'run.cjs'], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(dir, 'cache');
  try {
    const jobFile = path.join(dir, 'cache', 'specsmd-inferno', 'app', branch, 'lane-windows-job.json');
    fs.mkdirSync(path.dirname(jobFile), { recursive: true });
    fs.writeFileSync(jobFile, JSON.stringify({ pid: child.pid, lane: 'windows', started: '2026-09-10T12:47:11Z' }));
    assert.equal(owner.gateJobAlive(root).pid, child.pid);
    assert.equal(owner.ownership(root).lane, 'windows');
  } finally {
    child.kill('SIGKILL');
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  }
});
