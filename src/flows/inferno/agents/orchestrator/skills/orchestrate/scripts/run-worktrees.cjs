'use strict';

/**
 * The intent worktrees of a repository, read from `git worktree list`: which one an intent
 * owns, which branches it left, which intent a branch belongs to, and which trees a finished
 * run left standing.
 */

const path = require('path');

const lib = require('./run-lib.cjs');

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

module.exports = { branchesFor, intentOf, leftoverWorktrees, worktreeEntries, worktreeFor };
