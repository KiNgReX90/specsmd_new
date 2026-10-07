'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');

// The flow's suites run in every host's gate, so a temp dir a suite leaves behind leaks on
// every gate run on every machine. Tests and fixtures make their dirs through test-temp.cjs,
// which removes them all when the process exits.

const FLOW = path.resolve(__dirname, '../../../../..');
const HELPER = path.join(__dirname, 'test-temp.cjs');
// Built in two halves so this file never matches its own rule.
const DIRECT = new RegExp('\\bmk' + 'dtemp(?:Sync)?\\s*\\(');

const isTestCode = (file) => file.endsWith('.test.cjs') || file.endsWith('-fixture.cjs');

function offenders(files) {
  const found = [];
  for (const [file, source] of Object.entries(files)) {
    source.split('\n').forEach((line, at) => {
      if (DIRECT.test(line)) found.push(`${file}:${at + 1}`);
    });
  }
  return found;
}

function flowTestCode() {
  const files = {};
  for (const rel of fs.readdirSync(FLOW, { recursive: true, encoding: 'utf8' })) {
    if (!isTestCode(rel)) continue;
    files[rel] = fs.readFileSync(path.join(FLOW, rel), 'utf8');
  }
  return files;
}

function refusal(found) {
  return `${found.join('\n')}\n` +
    'These lines make a temp dir directly, and the dir outlives the run. Make it with\n' +
    `  const { tempDir } = require('<relative path to ${path.relative(FLOW, HELPER)}>');\n` +
    "  const dir = tempDir('inferno-<name>-');\n" +
    'so it is removed when the process exits.';
}

test('the rule catches a direct temp dir call in a sample source', () => {
  const sample = `const dir = fs.${'mk'}dtempSync(path.join(os.tmpdir(), 'x-'));\n`;
  assert.deepEqual(offenders({ 'a.test.cjs': sample }), ['a.test.cjs:1']);
  assert.deepEqual(offenders({ 'a.test.cjs': "const dir = tempDir('x-');\n" }), []);
});

test('every flow test and fixture makes its temp dirs through test-temp.cjs', () => {
  const files = flowTestCode();
  assert.ok(Object.keys(files).length > 0, `no test code found under ${FLOW}`);
  const found = offenders(files);
  assert.deepEqual(found, [], refusal(found));
});

test('a fixture-heavy suite leaves no temp dir behind', () => {
  const tmp = tempDir('inferno-leak-');
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  delete env.NODE_TEST_CONTEXT;
  const before = fs.readdirSync(tmp).length;
  const run = spawnSync(process.execPath, [path.join(__dirname, 'run-review-ladder.test.cjs')], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`.slice(-2000));
  const after = fs.readdirSync(tmp);
  assert.deepEqual(after, [], `${before} temp entries before the suite, ${after.length} after: ${after.join(', ')}`);
});
