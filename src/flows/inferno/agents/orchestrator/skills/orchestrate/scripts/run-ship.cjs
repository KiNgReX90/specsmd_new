'use strict';

/**
 * `run.cjs ship`: fold the base branch in, confirm the folded tree is green, merge, push,
 * prove the merge landed, and tear the worktree and branch down.
 *
 * It runs from the PRIMARY checkout, never from inside the worktree, because git refuses to
 * check the base branch out twice and the improvisation around that refusal (pushing
 * HEAD:base from the worktree) advances origin while the local base never moves. Every
 * precondition is its own refusal, and nothing after the merge is skipped silently: a
 * failure there prints exactly what is left to do.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { green } = require('./run-gate.cjs');

const { RunError } = lib;
const TERMINAL = new Set(['completed', 'done']);

/** The intent is shippable when the branch already closed it, archived or not. */
function closedInTree(tree, intentId) {
  const ledger = lib.readLedger(tree);
  const intent = ledger.intents.find((entry) => entry.id === intentId);
  if (intent) {
    if (TERMINAL.has(intent.status)) return { where: 'ledger', base_branch: intent.base_branch };
    throw new RunError(
      `refusing to ship ${intentId}: the worktree ledger has it ${intent.status || 'unset'}, not completed. Run close-intent first.`,
      'NOT_COMPLETE'
    );
  }
  const archive = path.join(tree, lib.SPECS_DIR, 'archive', 'state.yaml');
  if (fs.existsSync(archive) && new RegExp(`^ *- id: ${intentId}\\s*$`, 'm').test(fs.readFileSync(archive, 'utf8'))) {
    return { where: 'archive', base_branch: null };
  }
  throw new RunError(
    `refusing to ship ${intentId}: the worktree knows nothing about it, neither open nor completed in its ledger.`,
    'INTENT_NOT_FOUND'
  );
}

/** Kill only what this worktree spawned: processes whose cwd sits inside it. */
function killProcessesIn(tree) {
  const pids = (lib.processesIn(tree) || []).filter((pid) => pid !== process.pid && pid !== process.ppid);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      // Already gone between the scan and the signal: nothing to do.
    }
  }
  return pids;
}

function ship(intentId, options) {
  if (!options.tree) throw new RunError('ship requires --tree <worktree path>', 'BAD_ARGS', 1);
  const tree = path.resolve(options.tree);
  const primary = lib.primaryRoot(options.cwd);
  const config = lib.readConfig(primary);
  const closed = closedInTree(tree, intentId);
  const base = options.base || resolveBase(config, closed, primary);
  const branch = lib.git(tree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const out = [];

  const on = lib.currentBranch(primary);
  if (on !== base) {
    throw new RunError(`refusing to ship: the primary checkout is on ${on}, not the base branch ${base}.`, 'NOT_ON_BASE');
  }
  // The primary checkout usually carries other sessions' edits; every merge below runs with --autostash.
  const dirtyTree = lib.dirtyPaths(tree);
  if (dirtyTree.length > 0) {
    throw new RunError(`refusing to ship: the worktree carries ${dirtyTree.slice(0, 5).join(', ')}`, 'DIRTY');
  }

  // (1) Fold the base in, so the tree the gate passed is the tree that becomes the base.
  const remote = lib.git(primary, ['remote'], { tolerate: true });
  if (remote) {
    lib.git(primary, ['fetch', '--quiet', 'origin', base], { tolerate: true });
    const behind = lib.git(primary, ['rev-list', '--count', `${base}..origin/${base}`], { tolerate: true });
    if (behind && Number(behind) > 0) lib.git(primary, ['merge', '--no-edit', '--autostash', `origin/${base}`]);
  }
  const fold = lib.git(tree, ['merge', '--no-edit', base], { tolerate: true });
  if (fold === null) {
    const conflicts = lib.gitLines(tree, ['diff', '--name-only', '--diff-filter=U'], { tolerate: true });
    out.push(`conflict folding ${base} into ${branch}:`, ...conflicts.slice(0, 10));
    out.push('resolve them in the worktree, commit, then run ship again. Nothing else was done.');
    return { exit: 2, payload: { ok: false, step: 'fold', conflicts }, out };
  }

  // (2) The folded tree has to be the tree that passed the gate.
  const proof = green({ tree });
  if (proof.exit !== 0) {
    out.push(`${branch} is not green after folding ${base} in`, 'run gate first');
    return { exit: 3, payload: { ok: false, step: 'green', hash: proof.payload.hash }, out };
  }

  // (3) Merge, from the primary checkout.
  const tip = lib.git(tree, ['rev-parse', 'HEAD']);
  lib.git(primary, ['merge', '--no-ff', '--autostash', '-m', `Merge branch '${branch}'`, branch]);
  const sha = lib.git(primary, ['rev-parse', '--short', 'HEAD']);
  out.push(`merged ${branch} into ${base} as ${sha}`);

  const left = [];
  try {
    // (4) Push, and (5) prove the merge is an ancestor of what the base now points at.
    if (remote) {
      left.push(`push ${base}`);
      lib.git(primary, ['push', '--quiet', 'origin', base]);
      left.pop();
    }
    const target = remote ? `origin/${base}` : base;
    if (lib.git(primary, ['merge-base', '--is-ancestor', tip, target], { tolerate: true }) === null) {
      throw new RunError(`${branch} is not an ancestor of ${target} after the merge`, 'NOT_ANCESTOR');
    }
    out.push(`${base} verified against ${target}`);

    // (6) Teardown, safe because step 5 proved the work is reachable from the base branch.
    left.push(`git -C ${primary} worktree remove ${tree}`, `git -C ${primary} branch -d ${branch}`);
    const killed = killProcessesIn(tree);
    if (killed.length > 0) out.push(`stopped ${killed.length} process(es) in the worktree`);
    lib.git(primary, ['worktree', 'remove', tree]);
    left.shift();
    lib.git(primary, ['branch', '-d', branch]);
    left.shift();
  } catch (error) {
    out.push(`${error.message}`, `left to do: ${left.join('; ')}`);
    return { exit: 2, payload: { ok: false, step: 'after-merge', sha, left }, out };
  }

  out.push('shipped');
  return { exit: 0, payload: { ok: true, intent: intentId, branch, base, sha, tip }, out };
}

module.exports = { ship };
