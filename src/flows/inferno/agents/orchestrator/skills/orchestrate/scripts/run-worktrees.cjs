'use strict';

/**
 * The intent worktrees of a repository, read from `git worktree list`: which one an intent
 * owns, which branches it left, which intent a branch belongs to, and which trees a finished
 * run left standing. Also the bootstrap phases a worktree has completed, so a resume runs only
 * the phases still owed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { atomicWrite } = require('./state-store.cjs');

function worktreeEntries(root) {
  const out = [];
  let current = null;
  for (const line of lib.gitLines(root, ['worktree', 'list', '--porcelain'], { tolerate: true })) {
    if (line.startsWith('worktree ')) current = { path: line.slice(9), branch: null };
    else if (line.startsWith('branch ') && current) current.branch = line.slice(7).replace('refs/heads/', '');
    if (current && !out.includes(current)) out.push(current);
  }
  return out;
}

function branchesFor(root, intentId) {
  return lib
    .gitLines(root, ['branch', '--list', `inferno-intent/${intentId}-*`, '--format=%(refname:short)'], { tolerate: true });
}

function worktreeFor(root, intentId) {
  return worktreeEntries(root).find(
    (entry) => entry.branch && entry.branch.startsWith(`inferno-intent/${intentId}-`)
  );
}

/** The intent an `inferno-intent/<id>-<stamp>` branch belongs to, or null for any other branch. */
function intentOf(branch) {
  const match = /^inferno-intent\/(.+)-\d{8}T\d{6}Z$/.exec(branch || '');
  return match ? match[1] : null;
}

/**
 * Intent worktrees a finished run left standing: the branch is reachable from the base, so
 * everything in it shipped, and the ledger no longer has the intent in progress. A tree that
 * is in progress is a run or a recovery, never a leftover, whatever the base holds.
 */
function leftoverWorktrees(root, ledger, base) {
  const live = new Set(ledger.intents.filter((intent) => intent.status === 'in_progress').map((intent) => intent.id));
  const out = [];
  for (const entry of worktreeEntries(root)) {
    const id = intentOf(entry.branch);
    if (!id || live.has(id) || path.resolve(entry.path) === path.resolve(root)) continue;
    if (lib.git(root, ['merge-base', '--is-ancestor', entry.branch, base], { tolerate: true }) === null) continue;
    out.push({ id, path: entry.path, branch: entry.branch });
  }
  return out;
}

// ---------------------------------------------------------------------------
// bootstrap phases
// ---------------------------------------------------------------------------

/**
 * Each bootstrap command is a phase, recorded in the worktree's own git dir once it passes.
 * An interrupted or failed bootstrap used to leave the tree standing, and the next `worktree`
 * call saw the tree and reported a resume with the dependencies absent or half installed. Now
 * a resume runs the phases that never completed and skips the ones that did, unless the
 * commands or the dependency files they read changed since, which reruns from that phase on.
 */
const BOOTSTRAP = 'inferno-bootstrap.json';
const DEPENDENCY_FILE = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|uv\.lock|go\.mod|go\.sum)$/;

function bootstrapPath(tree) {
  return path.resolve(tree, lib.git(tree, ['rev-parse', '--git-path', BOOTSTRAP]));
}

/** A fingerprint of the commands up to a phase and of the dependency files they install from. */
function bootstrapInput(tree, commands) {
  const files = lib.gitLines(tree, ['ls-files'])
    .filter((file) => DEPENDENCY_FILE.test(file) || commands.some((command) => command.includes(file)));
  const hash = crypto.createHash('sha256').update(JSON.stringify(commands));
  for (const file of files.sort()) {
    const abs = path.join(tree, file);
    hash.update(file);
    hash.update(fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs) : 'missing');
  }
  return hash.digest('hex');
}

function readBootstrap(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return record && Array.isArray(record.phases) ? record : null;
  } catch (error) {
    return null;
  }
}

/**
 * Run the bootstrap phases still owed. An edit someone made in the tree is never counted as
 * the bootstrap's mess, but a change a phase made stays the bootstrap's on every later call,
 * recorded in `changed`, so a plain retry never reports a dirtying bootstrap complete.
 */
function bootstrap(tree, intentId, commands, options) {
  const file = bootstrapPath(tree);
  const record = readBootstrap(file) || { version: 1, intent: intentId, phases: [] };
  const owned = new Set(record.changed || []);
  const save = () => atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
  const prior = lib.dirtyPaths(tree).filter((file) => !owned.has(file));
  const made = () => lib.dirtyPaths(tree).filter((file) => !prior.includes(file));
  const results = [];
  record.complete = false;
  record.changed = made();
  save();
  for (const [index, command] of commands.entries()) {
    const input = bootstrapInput(tree, commands.slice(0, index + 1));
    const done = record.phases[index];
    if (done && done.complete && done.input === input) continue;
    record.phases = record.phases.slice(0, index);
    const log = path.join(lib.cacheDir(options.root), 'bootstrap', `${intentId}-${index}.log`);
    const result = (options.runShell || lib.runShell)(command, tree, log, { wrap: false });
    record.phases[index] = { command, input, complete: result.code === 0, code: result.code, log };
    record.changed = made();
    results.push(result);
    save();
    if (result.code !== 0) return { ok: false, results, log };
  }
  record.phases = record.phases.slice(0, commands.length);
  if (record.changed.length > 0) return { ok: false, results, dirty: record.changed };
  record.complete = true;
  save();
  return { ok: true, results };
}

module.exports = { bootstrap, bootstrapPath, branchesFor, intentOf, leftoverWorktrees, worktreeEntries, worktreeFor };
