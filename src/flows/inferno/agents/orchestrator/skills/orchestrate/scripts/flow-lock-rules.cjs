'use strict';

/**
 * When a rule started on this host, as the installer recorded it in `flow.lock`.
 *
 * A rule that holds back work its host completed or captured without it starts per host, at
 * the first install of a flow that carries it. The flow declares the rule in
 * `flow-rules.json`, the installer stamps the moment into the lock, and every later install
 * carries it forward. Whoever enforces the rule reads the moment here.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** Where the host's install record sits, relative to a checkout. */
const LOCK = path.join('.specsmd', 'inferno', 'flow.lock');

/**
 * The checkout whose flow.lock holds the cutover: the primary one, where the installer writes
 * it. An intent worktree cut before the lock was committed, or beside a lock left untracked,
 * has none of its own. Git names the primary as the parent of the common `.git` dir. A tree
 * outside git, or one whose common dir is bare, is read as it stands.
 */
function primaryCheckout(root) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  const [top, common] = result.status === 0 ? result.stdout.trim().split('\n') : [];
  if (!top || !common || fs.realpathSync(top) !== fs.realpathSync(root)) return root;
  const dir = path.resolve(root, common);
  return path.basename(dir) === '.git' ? path.dirname(dir) : root;
}

/** The moment the lock in `dir` records for `rule`, in milliseconds, or null when it holds none. */
function lockRule(dir, rule) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, LOCK), 'utf8'));
    const since = Date.parse((lock.rules && lock.rules[rule]) || '');
    return Number.isNaN(since) ? null : since;
  } catch (error) {
    return null;
  }
}

/** When `rule` started on the host `root` belongs to, or null when its lock records none. */
function ruleSince(root, rule) {
  return lockRule(primaryCheckout(root), rule);
}

module.exports = { LOCK, lockRule, primaryCheckout, ruleSince };
