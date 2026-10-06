'use strict';

/**
 * The item review on the ledger: the `review-item` transition and the rule complete-item
 * checks against it.
 *
 * Its own module beside state-transition.cjs, the way state-block.cjs is: the writer stands
 * near the ceiling, and a review is a question of its own. Claim and complete say who builds
 * the item and how far it got. This says whether a cold reviewer found the item meets its
 * brief, which tier built the version it read, and how often that tier was sent back.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  TransitionError, findKeyLine, unquote, loadState, locateWorkItems, getIntent, setField, nowIso, writeState,
} = require('./state-ledger.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

/** Where the host's install record sits, relative to the primary checkout. */
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

/** What a host with no recorded cutover is told, on every refusal the rule makes. */
const REINSTALL = 'This host\'s .specsmd/inferno/flow.lock records no review cutover, so every item owes ' +
  'one: reinstall the flow to record it, and items completed before that stay exempt.';

/**
 * When the item review became mandatory on this host: the moment its first install of a flow
 * carrying the rule, as the installer recorded it in the primary checkout's flow.lock. An
 * item completed before it was integrated under a flow with no review. Null when the lock
 * records none, and then the rule applies to every item.
 */
function reviewRuleSince(root) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(primaryCheckout(root), LOCK), 'utf8'));
    const since = Date.parse((lock.rules && lock.rules.review) || '');
    return Number.isNaN(since) ? null : since;
  } catch (error) {
    return null;
  }
}

const TIERS = new Set(['cheap', 'strong', 'escalate']);

/** One field of a ledger entry as a plain string, or null when the entry has none. */
function entryField(lines, entry, key) {
  const idx = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  return idx === -1 ? null : unquote(lines[idx].slice(entry.keyIndent + key.length + 1));
}

/**
 * Whether a completed item predates the review rule on this host. An item with no
 * completed_at was written by a flow older than the timestamp, so it predates it too.
 */
function completedBeforeReviewRule(completedAt, since) {
  if (since === null) return false;
  const completed = Date.parse(completedAt || '');
  return Number.isNaN(completed) || completed < since;
}

/**
 * The backstop complete-item runs after its idempotent return: an item is completed only
 * over a clean review, unless it was already completed before the rule.
 */
function refuseUnreviewed(lines, item, itemId, alreadyComplete, stateFile) {
  if (entryField(lines, item, 'review') === 'clean') return;
  const since = reviewRuleSince(path.dirname(path.dirname(path.resolve(stateFile))));
  if (alreadyComplete && completedBeforeReviewRule(entryField(lines, item, 'completed_at'), since)) return;
  throw new TransitionError(
    `refusing to complete ${itemId}: its item review is not clean. Run run.cjs review ` +
      `--item ${itemId} --tree <worktree>, have the builder fix every finding until the ` +
      `review is clean, then integrate.${since === null ? ` ${REINSTALL}` : ''}`,
    'REVIEW_OWED'
  );
}

/**
 * Record one review verdict on a work item.
 *
 * The count of rejections is kept per tier, because the ladder asks how often the builder
 * now holding the item was sent back: it goes up by one on `fix` and starts over when the
 * tier that built the reviewed version is not the one recorded. `run.cjs review --item` is
 * the caller: it validates the reviewer's file and hashes the files the review binds first.
 */
function reviewItem(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const verdict = String(options.verdict || '');
  if (verdict !== 'clean' && verdict !== 'fix') {
    throw new TransitionError(`refusing review-item: --verdict must be clean or fix, not ${verdict || 'empty'}.`, 'BAD_VERDICT');
  }
  const hash = String(options.files_hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new TransitionError('refusing review-item: --files-hash must be the 64 hex digits run.cjs review computed.', 'BAD_HASH');
  }
  const tier = String(options.tier || '');
  if (!TIERS.has(tier)) {
    throw new TransitionError(`refusing review-item: --tier must be cheap, strong or escalate, not ${tier || 'empty'}.`, 'BAD_TIER');
  }
  const commit = String(options.commit || '').trim();
  if (!commit) {
    throw new TransitionError('refusing review-item with no --commit: name the commit the reviewer read.', 'NO_COMMIT');
  }

  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const item = locateWorkItems(lines, intent).find((entry) => entry.id === options.item);
  if (!item) {
    throw new TransitionError(`work item not found: ${options.item} in intent ${options.intent}.`, 'ITEM_NOT_FOUND');
  }

  const previous = entryField(lines, item, 'review_tier') === tier
    ? Number(entryField(lines, item, 'review_rejections')) || 0
    : 0;
  const rejections = previous + (verdict === 'fix' ? 1 : 0);
  const reviewedAt = nowIso(options.now);
  // Each insert lands directly under `status:`, so write back to front to leave the order
  // review, review_hash, review_commit, review_tier, review_rejections, reviewed_at.
  for (const [key, value] of [
    ['reviewed_at', reviewedAt],
    ['review_rejections', String(rejections)],
    ['review_tier', tier],
    ['review_commit', commit],
    ['review_hash', hash],
    ['review', verdict],
  ]) {
    const before = lines.length;
    setField(lines, item, key, value);
    item.end += lines.length - before;
  }
  writeState(file, lines);

  return { changed: true, item: options.item, verdict, tier, rejections, reviewed_at: reviewedAt };
}

module.exports = { REINSTALL, completedBeforeReviewRule, refuseUnreviewed, reviewItem, reviewRuleSince };
