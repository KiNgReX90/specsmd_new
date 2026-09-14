const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');

function tempdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function hashTree(t) {
  const dir = tempdir('inferno-lib-scope-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  lib.git(dir, ['config', 'user.email', 'test@example.com']);
  lib.git(dir, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, '.specs-inferno'));
  fs.writeFileSync(path.join(dir, 'src/input.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'outside\n');
  fs.writeFileSync(path.join(dir, '.specs-inferno/state.yaml'), 'ledger\n');
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
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'moved\n');
  fs.writeFileSync(path.join(dir, '.specs-inferno/state.yaml'), 'moved\n');
  assert.equal(hash(), before);
  fs.writeFileSync(path.join(dir, 'src/input.txt'), 'two\n');
  const dirty = hash();
  assert.notEqual(dirty, before);
  hashCommit(dir);
  assert.equal(hash(), dirty);
  const all = proofs.scopeHash(dir);
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'again\n');
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
