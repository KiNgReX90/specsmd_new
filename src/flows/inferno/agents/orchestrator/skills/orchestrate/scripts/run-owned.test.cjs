'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./run-lib.cjs');
const scheduler = require('./team-scheduler.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-owned-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('scheduler and verifier resolve the same directory and symlink aliases', (t) => {
  const tree = fixture(t);
  fs.mkdirSync(path.join(tree, 'src'), { recursive: true });
  fs.symlinkSync('src', path.join(tree, 'alias'));
  assert.equal(lib.ownedBy('src/file.ts', ['./alias/../src/**'], tree), true);
  assert.equal(lib.ownedBy('alias/file.ts', ['src'], tree), true);
  assert.equal(lib.overlaps('alias', 'src/file.ts', tree), true);
  assert.equal(lib.ownedBy('src/file.rs', ['src/*.ts'], tree), false);
  fs.symlinkSync(os.tmpdir(), path.join(tree, 'outside'));
  const refusal = { name: 'RunError', code: 'OWNERSHIP', message: /escapes/ };
  assert.throws(() => lib.ownedBy('src/file.ts', ['outside/**'], tree), refusal);
  assert.throws(() => lib.ownedBy('src/file.ts', ['../elsewhere'], tree), refusal);
  assert.throws(() => lib.overlaps('src/[ab', 'src/a', tree), { code: 'OWNERSHIP' });
});

test('a changed path that leaves the tree is owned by nobody rather than a crash', (t) => {
  const tree = fixture(t);
  fs.symlinkSync(os.tmpdir(), path.join(tree, 'node_modules'));
  assert.equal(lib.ownedBy('node_modules/x.js', ['src/'], tree), false);
  assert.equal(lib.ownedBy('../x.js', ['src/'], tree), false);
});

test('character-class owners cannot dispatch overlapping writers', () => {
  assert.equal(lib.overlaps('src/[ab]/**', 'src/a/file.ts'), true);
  assert.equal(lib.ownedBy('src/b/file.ts', ['src/[a-c]/**']), true);
  assert.equal(lib.ownedBy('src/z/file.ts', ['src/[!a-c]/**']), true);
  assert.equal(lib.ownedBy('src/z/file.ts', ['src/[a-c]/**']), false);
  assert.equal(lib.overlaps('src/[ab]/**', 'src/[xy]/**'), false);
});

test('the scheduler holds a directory owner and its descendant apart, in either order', (t) => {
  const tree = fixture(t);
  fs.mkdirSync(path.join(tree, 'src/app'), { recursive: true });
  fs.symlinkSync('src', path.join(tree, 'alias'));
  const item = (id, editable) => ({ id, ownership: { editable } });
  const ids = (items, options) => scheduler.selectDispatchableItems(items, { tree, ...options }).map((entry) => entry.id);
  assert.deepEqual(ids([item('dir', ['src/app']), item('file', ['src/app/page.ts'])]), ['dir']);
  assert.deepEqual(ids([item('file', ['./src/app/page.ts']), item('dir', ['src/app/'])]), ['file']);
  assert.deepEqual(ids([item('alias', ['alias/app/page.ts'])], { inFlightItems: [item('dir', ['src/app'])] }), []);
  assert.deepEqual(ids([item('a', ['src/app/a.ts']), item('b', ['src/app/b.ts'])]), ['a', 'b']);
});
