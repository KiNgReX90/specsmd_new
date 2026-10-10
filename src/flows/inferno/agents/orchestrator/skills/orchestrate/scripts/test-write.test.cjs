'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');

// Git decides whether a tracked file changed from its size and its timestamps, most builds by the whole second.
// A fixture that rewrites a file at the same length passes unseen when the file's second repeats under an index
// stamped later, which is what a clock set back mid-run produces. Then `git add` stages nothing, the commit says
// "nothing to commit", and a status or diff reads the tree as clean. Tests and fixtures write through
// test-write.cjs, which never leaves a rewrite on a second the file had before.

const FLOW = path.resolve(__dirname, '../../../../..');
const HELPER = path.join(__dirname, 'test-write.cjs');
const SCRIPTS = path.relative(FLOW, __dirname);
// Built in two halves so this file never matches its own rule.
const PLAIN = 'write' + 'FileSync';
const DIRECT = new RegExp(`\\b${PLAIN}\\b`);
// Lines of a script a fixture writes out for another process to run. The helper is not loaded there.
const CHILD_SCRIPTS = {
  'run-gate.test.cjs': "if (name === 'mutate')",
  'run-lanes-fixture.cjs': "if (code === 'movewait')",
  'state-transactions.test.cjs': 'fs.readFileSync=function',
};

const isTestCode = (file) => file.endsWith('.test.cjs') || file.endsWith('-fixture.cjs');
const second = (ms) => Math.floor(ms / 1000);

/** Every line of test code in a {file: source} map that writes a file without the helper. */
function offenders(files, children = CHILD_SCRIPTS) {
  const found = [];
  for (const [file, source] of Object.entries(files)) {
    if (!isTestCode(file)) continue;
    const child = children[path.basename(file)];
    source.split('\n').forEach((line, at) => {
      if (DIRECT.test(line) && !(child && line.includes(child))) found.push(`${file}:${at + 1}`);
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
    'These lines write a file directly, and git can miss a rewrite that keeps the length. Write it with\n' +
    `  const { writeFile } = require('<relative path to ${path.relative(FLOW, HELPER)}>');\n` +
    '  writeFile(file, body);\n' +
    'so a rewrite never keeps a second the file had before.';
}

function git(root, ...args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

/**
 * The fixture sequence under the forced condition: commit a file, stamp the index later than the file, then
 * rewrite the file at the same length inside the second git recorded for it. Returns the second commit.
 */
function rewriteUnderALaterIndex(write) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const root = tempDir('inferno-write-');
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    const file = path.join(root, 'outside.txt');
    write(file, 'outside\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'fixture');
    const recorded = second(fs.statSync(file).ctimeMs);
    const index = path.join(root, '.git', 'index');
    const later = second(fs.statSync(index).mtimeMs) + 10;
    fs.utimesSync(index, later, later);
    write(file, 'changed\n');
    // Both writes have to fall in one second, or the condition was never forced.
    if (second(fs.statSync(file).ctimeMs) !== recorded) continue;
    git(root, 'add', '-A');
    const commit = git(root, 'commit', '-qm', 'fixture');
    return { code: commit.status, out: commit.stdout + commit.stderr, subject: git(root, 'show', '--format=', '--name-only', 'HEAD').stdout.trim() };
  }
  throw new Error('no attempt kept both writes inside one second');
}

test('a same-length rewrite inside the recorded second reaches the next commit', (t) => {
  const plain = rewriteUnderALaterIndex((file, body) => fs[PLAIN](file, body));
  if (plain.code === 0) {
    t.skip('this git compares timestamps finer than a second, so it sees the plain rewrite too');
    return;
  }
  assert.match(plain.out, /nothing to commit/);
  const helped = rewriteUnderALaterIndex(writeFile);
  assert.equal(helped.code, 0, helped.out);
  assert.equal(helped.subject, 'outside.txt');
});

test('a rewrite never keeps a second the file had before, and a first write keeps its own', () => {
  const dir = tempDir('inferno-write-');
  const file = path.join(dir, 'a.txt');
  const before = second(Date.now());
  writeFile(file, 'one\n');
  const seen = [second(fs.statSync(file).mtimeMs)];
  assert.ok(seen[0] >= before && seen[0] <= second(Date.now()), 'the first write keeps the time it was made');
  for (const body of ['two\n', 'six\n', 'ten\n']) {
    writeFile(file, body);
    assert.equal(fs.readFileSync(file, 'utf8'), body);
    seen.push(second(fs.statSync(file).mtimeMs));
  }
  assert.equal(new Set(seen).size, seen.length, `seconds repeat: ${seen.join(', ')}`);
  // A time put back by hand, as a clock set back would leave it, is a second the file had before too.
  fs.utimesSync(file, seen[0], seen[0]);
  writeFile(file, 'put\n');
  fs.utimesSync(file, seen[0], seen[0]);
  writeFile(file, 'end\n');
  assert.ok(!seen.includes(second(fs.statSync(file).mtimeMs)));
});

test('the helper passes the options on and writes through a symlink', () => {
  const dir = tempDir('inferno-write-');
  const script = path.join(dir, 'run.sh');
  writeFile(script, '#!/bin/sh\n', { encoding: 'utf8', mode: 0o755 });
  assert.equal(fs.statSync(script).mode & 0o777, 0o755);
  fs.symlinkSync(script, path.join(dir, 'link'));
  writeFile(path.join(dir, 'link'), '#!/bin/ok\n');
  assert.equal(fs.readFileSync(script, 'utf8'), '#!/bin/ok\n');
  assert.ok(fs.lstatSync(path.join(dir, 'link')).isSymbolicLink());
});

test('the rule catches every direct write in tests and fixtures, and only there', () => {
  const lines = [`fs.${PLAIN}(file, body);`, `const { ${PLAIN} } = require('node:fs');`, `  if (child) fs.${PLAIN}('x', 'y');`];
  const source = `${lines.join('\n')}\nwriteFile(file, body);\n`;
  assert.deepEqual(offenders({ 'a.test.cjs': source, 'b-fixture.cjs': source, 'run-x.cjs': source }, { 'a.test.cjs': 'if (child)' }), [
    'a.test.cjs:1', 'a.test.cjs:2', 'b-fixture.cjs:1', 'b-fixture.cjs:2', 'b-fixture.cjs:3',
  ]);
});

test('every flow test and fixture writes its files through test-write.cjs', () => {
  const files = flowSources();
  // The guard reaches only what it collects, so a test file and the fixtures most writes come from are named here.
  for (const name of ['run-proofs.test.cjs', 'review-fixture.cjs', 'run-fixture.cjs']) {
    assert.ok(path.join(SCRIPTS, name) in files, `${name} is not collected from ${FLOW}`);
  }
  const found = offenders(files);
  assert.deepEqual(found, [], refusal(found));
});
