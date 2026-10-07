'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');

// The flow's suites run in every host's gate, so a temp dir a suite leaves behind leaks on
// every gate run on every machine. Tests and fixtures make their dirs through test-temp.cjs,
// which removes them all when the process ends, however it ends.

const FLOW = path.resolve(__dirname, '../../../../..');
const HELPER = path.join(__dirname, 'test-temp.cjs');
// Built in two halves so this file never matches its own rule.
const DIRECT = new RegExp('\\bmk' + 'dtemp(?:Sync)?\\b');

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
  assert.ok(Object.keys(files).some(isTestCode), `no test code found under ${FLOW}`);
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

for (const [name, end] of [
  ['a failing test', "require('node:test')('fails', () => { throw new Error('red'); });"],
  ['an uncaught throw', "throw new Error('red');"],
  ['an early exit', 'process.exit(3);'],
]) {
  test(`the dirs go when the process ends on ${name}`, () => {
    const { tmp, env } = privateRoot();
    const run = spawnSync(process.execPath, ['-e', child(end)], { env, encoding: 'utf8' });
    assert.notEqual(run.status, 0, run.stderr);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`the dirs go when the process is killed with ${signal}, and the signal still ends it`, async () => {
    const { tmp, env } = privateRoot();
    const proc = spawn(process.execPath, ['-e', child("process.stdout.write('ready'); setInterval(() => {}, 1000);")], { env });
    await new Promise((resolve) => proc.stdout.once('data', resolve));
    assert.equal(fs.readdirSync(tmp).length, 1);
    const [code, ended] = await new Promise((resolve) => {
      proc.on('exit', (...result) => resolve(result));
      proc.kill(signal);
    });
    assert.deepEqual({ code, ended }, { code: null, ended: signal });
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
}
