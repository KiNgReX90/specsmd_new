'use strict';

/**
 * Test fixtures for the item review: a throwaway host repository with one intent, and the
 * helpers that record a clean review the way the reviewer and `run.cjs review` do.
 *
 * Shared by every run*.test.cjs suite that needs a review on record (the review suites, the
 * integrate and gate suites, and run-fixture.cjs), so the review they need is written in one place.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const WRITER = path.join(__dirname, 'state-transition.cjs');

/** The host's install record, with the review cutover well before every test timestamp now. */
const LOCK_PATH = '.specsmd/inferno/flow.lock';
const CUTOVER = '2026-09-20T00:00:00.000Z';
const hostLock = (since = CUTOVER) => `${JSON.stringify({ flow: 'inferno', rules: { review: since }, files: {} })}\n`;

const STATE = `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: in_progress
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: a-one
        title: "A one"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: a-two
        title: "A two"
        kind: docs-only
        complexity: medium
        status: pending
        depends_on: [a-one]
`;

const CONFIG = `models:
  strong: model-strong
  cheap: model-cheap
  escalate: model-escalate
review:
  model: model-review
verification:
  integrate:
    - echo integrate ran
delivery:
  base_branch: main
`;

function spec(id, editable, depends = []) {
  return `---
id: ${id}
title: "${id}"
intent: alpha
status: pending
depends_on: [${depends.join(', ')}]
---

# Work Item: ${id}

## Execution Manifest

context:
  required:
    - path: src/a.ts
      reason: why
  patterns:
    - path: src/b.ts
      reason: why
  tests:
    - path: src/a.test.ts
      reason: why
ownership:
  editable:
${editable.map((p) => `    - ${p}`).join('\n')}
`;
}

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, 'utf8');
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A host repository on main: a ledger, a config, a brief, two item specs, the install lock. */
function repo(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-review-'));
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'src/b.ts', 'export const b = 2;\n');
  write(root, 'src/a.test.ts', '// proof\n');
  write(root, 'docs/b.md', 'docs\n');
  for (const [rel, body] of Object.entries(options.files || {})) write(root, rel, body);
  write(root, '.specs-inferno/state.yaml', options.state || STATE);
  write(root, '.specs-inferno/config.yaml', options.config || CONFIG);
  if (options.lock !== null) write(root, LOCK_PATH, hostLock(options.lock));
  write(root, '.specs-inferno/intents/alpha/brief.md', '# Intent: Alpha\n');
  write(root, '.specs-inferno/intents/alpha/work-items/a-one.md', spec('a-one', options.editable || ['src/a.ts', 'src/a2.test.ts']));
  write(root, '.specs-inferno/intents/alpha/work-items/a-two.md', spec('a-two', ['docs/b.md', 'src/b.ts'], ['a-one']));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return { root, cache: path.join(dir, 'cache') };
}

/** An intent worktree beside the fixture's primary checkout, cut from main as it stands now. */
function worktree(fixture, name = 'wt') {
  const tree = path.join(path.dirname(fixture.root), name);
  git(fixture.root, ['worktree', 'add', '-q', '-b', `inferno-intent/${name}`, tree]);
  return tree;
}

function run(fixture, args, cwd = fixture.root) {
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

/**
 * The calls of one kind a text prints, each as the argv it names: `scan`, `collect`, `review`,
 * `review --item`, `integrate --item`, `gate` and so on, of run.cjs or of another script. A
 * sentence's closing period is not part of the call.
 */
function printed(text, kind, script = 'run') {
  const kindOf = (argv) => (argv.includes('--collect') ? 'collect' : argv.includes('--item') ? `${argv[0]} --item` : argv[0]);
  const call = new RegExp(`(?<![\\w-])${script}\\.cjs ([a-z-]+(?: --[a-z-]+(?: (?!--)[^\\s,]+)?)*)`, 'g');
  return [...text.matchAll(call)]
    .map((match) => match[1].replace(/\.$/, '').split(' '))
    .filter((argv) => kindOf(argv) === kind);
}

/** Run every call of one kind the text prints, exactly as printed, from the project root. */
function asPrinted(fixture, text, kind) {
  const calls = printed(text, kind);
  assert.ok(calls.length > 0, `no ${kind} call printed in: ${text}`);
  return calls.map((argv) => ({ argv, ...run(fixture, argv) }));
}

/**
 * Run the first line that names the runner by its own path exactly as printed: through a shell,
 * from outside the scripts dir, so a line that names the runner without a usable path fails.
 */
function asPrintedByPath(fixture, text) {
  const match = /\bnode (\S+) ([a-z-]+(?: --[a-z-]+(?: (?!--)[^\s,]+)?)*)/.exec(text);
  assert.ok(match, `no line naming the runner by its path in: ${text}`);
  const line = `node ${match[1]} ${match[2].replace(/\.$/, '')}`;
  const result = spawnSync('sh', ['-c', line], {
    cwd: path.dirname(fixture.root), encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  return { argv: [line], code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

/**
 * Record a clean item review for each id through `run.cjs review`, so an integrate --item
 * call meets the review it requires. `runner` is the caller's own CLI driver.
 */
function reviewed(runner, fixture, tree, ids, files = ['src/a.ts'], intent = 'alpha') {
  for (const id of ids) {
    write(tree, `.specs-inferno/intents/${intent}/reviews/${id}.yaml`, `item: ${id}\nverdict: clean\nfiles: [${files.join(', ')}]\n`);
    const result = runner(fixture, ['review', '--item', id, '--tree', tree]);
    assert.equal(result.code, 0, result.out + result.err);
  }
}

/** The worktree name whose branch run.cjs reads as an intent branch of alpha. */
const INTENT_TREE = 'alpha-00000000T000000Z';

/**
 * Record an intent review for the tree as it stands, the way `run.cjs review` records one:
 * the reviewer's body plus the tree hash and commit, committed through a pathspec. The scan
 * the review owes first is recorded with no lines when none was collected.
 */
function intentReviewed(tree, intent = 'alpha', body = 'verdict: clean\n') {
  const proofs = require('./run-proofs.cjs');
  const { intentReviewPath, scanPath } = require('./run-intent-owed.cjs');
  const rel = intentReviewPath(tree, intent);
  const scan = scanPath(tree, intent);
  const paths = [rel];
  if (!fs.existsSync(path.join(tree, scan))) {
    write(tree, scan, 'lines: []\n');
    paths.push(scan);
  }
  write(tree, rel, `${body}tree: ${proofs.scopeHash(tree)}\ncommit: ${git(tree, ['rev-parse', 'HEAD'])}\n`);
  git(tree, ['add', '--', ...paths]);
  git(tree, ['commit', '-qm', `intent review ${intent}`, '--', ...paths]);
}

/**
 * For a test about something else: before a gate or green call, record a clean intent
 * review when the clean tree has none for its content. The refusals themselves are proved in
 * run-gate-review.test.cjs, which never calls this.
 */
function reviewBefore(args, cwd) {
  if (!['gate', 'green'].includes(args[0]) || args.includes('--wait')) return;
  const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const tree = path.resolve(cwd, at('--tree') || '.');
  const { intentOf } = require('./run-worktrees.cjs');
  const intent = at('--intent') || intentOf(git(tree, ['rev-parse', '--abbrev-ref', 'HEAD']));
  if (!intent || git(tree, ['status', '--porcelain']) !== '') return;
  const { intentReviewState } = require('./run-intent-owed.cjs');
  if (intentReviewState(tree, {}, intent).owed.length > 0) intentReviewed(tree, intent);
}

/**
 * Start a mutate whose test waits for a release file, and resolve once its mutant sits in line 1
 * of `file`. `release` lets it finish and restore; `kill` ends it outright, so the mutant and
 * its journal stay behind.
 */
async function heldMutate(fixture, tree, file = 'src/a.ts', replace = 'export const a = 99;') {
  const abs = path.join(tree, file);
  const before = fs.readFileSync(abs, 'utf8');
  const release = path.join(path.dirname(fixture.root), `release-${process.hrtime.bigint()}`);
  const child = spawn(process.execPath, [RUN, 'mutate', '--tree', tree, '--file', file, '--line', '1', '--replace', replace,
    '--test', `until [ -f ${release} ]; do sleep 0.05; done`],
  { cwd: tree, env: { ...process.env, XDG_CACHE_HOME: fixture.cache }, stdio: 'ignore' });
  const done = new Promise((resolve) => child.on('close', resolve));
  for (let i = 0; i < 200 && fs.readFileSync(abs, 'utf8') === before; i += 1) await new Promise((r) => setTimeout(r, 25));
  const landed = fs.readFileSync(abs, 'utf8') !== before;
  if (!landed) child.kill('SIGKILL');
  assert.ok(landed, 'the mutant never landed');
  return {
    release: async () => {
      fs.writeFileSync(release, '');
      await done;
    },
    kill: async () => {
      child.kill('SIGKILL');
      await done;
      fs.writeFileSync(release, '');
    },
  };
}

/** Leave behind what a mutate killed outright leaves: its mutant in line 1 of `file` and its journal. */
async function killedMutate(fixture, tree, file, replace) {
  await (await heldMutate(fixture, tree, file, replace)).kill();
}

/** Mark items reviewed clean straight through the writer, for a ledger a test completes by hand. */
function markReviewed(state, ids, intent = 'alpha') {
  for (const id of ids) {
    execFileSync(process.execPath, [WRITER, 'review-item', '--intent', intent, '--item', id, '--file', state,
      '--verdict', 'clean', '--files-hash', 'a'.repeat(64), '--tier', 'cheap', '--commit', 'abc1234']);
  }
}

module.exports = {
  CONFIG, INTENT_TREE, LOCK_PATH, STATE, asPrinted, asPrintedByPath, git, heldMutate, hostLock, intentReviewed, killedMutate, markReviewed,
  printed, repo, reviewBefore, reviewed, run, worktree, write,
};
