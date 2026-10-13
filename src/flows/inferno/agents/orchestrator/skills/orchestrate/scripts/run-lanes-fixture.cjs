'use strict';

/**
 * Test fixtures for the smoke and Windows lanes: a throwaway host repo on an intent branch whose
 * lanes are stub commands, `node lane.cjs <name> <exit code | wait | movewait | file>`. `wait`
 * holds until the release file exists, `movewait` then writes an in-scope file, and `file` exits
 * with the code written to the code file outside the tree.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { reviewBefore } = require('./review-fixture.cjs');

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const DEFAULT = '.specs-inferno/config.yaml';
const whole = 'node proof.cjs whole';
const red = 'node proof.cjs red';

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  writeFile(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(tree, message = 'change') {
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', message);
}

/** A config whose lanes are the stub commands above, one `<lane>: <token>` entry each. */
function config(lanes = { smoke: '0' }, finalize = [whole], scope = ['src/**']) {
  const blocks = Object.entries(lanes).map(([name, code]) =>
    `  ${name}:\n    command: node lane.cjs ${name} ${code}\n    scope: ${JSON.stringify(scope)}\n`).join('');
  return `delivery:\n  base_branch: main\nverification:\n  finalize:\n${finalize.map((c) => `    - ${c}\n`).join('')}${blocks}`;
}

function fixture(t, source = config()) {
  const dir = tempDir('inferno-lanes-');
  t.after(() => {
    writeFile(path.join(dir, 'release'), '');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const tree = path.join(dir, 'app');
  const release = path.join(dir, 'release');
  fs.mkdirSync(tree);
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  write(tree, '.gitignore', '.runs\n.lane-runs\n');
  write(tree, 'src/input.txt', 'one\n');
  write(tree, 'docs/readme.txt', 'one\n');
  const code = path.join(dir, 'code');
  write(tree, DEFAULT, source.replace(/ (wait|movewait)\n/g, ` $1 ${release}\n`).replace(/ file\n/g, ` file ${code}\n`));
  write(tree, 'proof.cjs', `const fs = require('node:fs');
fs.appendFileSync('.runs', process.argv[2] + '\\n');
if (process.argv[2] === 'red') process.exit(1);
`);
  write(tree, 'lane.cjs', `const fs = require('node:fs');
const [name, code, release] = process.argv.slice(2);
fs.appendFileSync('.lane-runs', name + '\\n');
if (code === 'wait' || code === 'movewait') {
  while (!fs.existsSync(release) && fs.existsSync('lane.cjs')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  if (code === 'movewait') fs.writeFileSync('src/moved.txt', 'moved\\n');
  process.exit(0);
}
process.exit(Number(code === 'file' ? fs.readFileSync(release, 'utf8') : code));
`);
  commit(tree, 'fixture');
  git(tree, 'checkout', '-qb', BRANCH);
  return { tree, release, code, cache: path.join(dir, 'cache') };
}

function run(f, ...args) {
  reviewBefore(args, f.tree);
  // CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
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

/** The branch's cache dir, where the gate and lane job files live. */
function cacheOf(f) {
  return path.join(f.cache, 'specsmd-inferno', 'app', BRANCH);
}

module.exports = {
  BRANCH, acceptLine, cacheOf, commit, config, fixture, gated, git, harnessFix, laneRuns, passed, red, run, touch, whole, write,
};
