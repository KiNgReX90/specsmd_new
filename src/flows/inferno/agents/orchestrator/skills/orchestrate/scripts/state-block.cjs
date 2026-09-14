'use strict';

/**
 * Parking an intent: the `block-intent` and `unblock-intent` transitions.
 *
 * Its own module beside state-transition.cjs, which stood at the ceiling when this pair was
 * owed. The boundary is the question each transition answers. Claim and complete say who is
 * building this and how far they got. These two say whether it may be built at all, which is
 * a question about the world outside the ledger.
 *
 * Every write here goes through the same primitives the rest of the writer uses, so a parked
 * entry is surgically edited and its comment block survives.
 */

const {
  TransitionError, loadState, getIntent, statusOf, setField, removeField, nowIso, writeState,
} = require('./state-ledger.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

/**
 * One quoted YAML scalar for a line of free text. The ledger's reader strips the quotes and
 * never unescapes, so the style is picked to need no escape: single quotes around a reason
 * that carries a double quote, double quotes otherwise. A colon or a hash inside then reaches
 * the next reader whole. An unquoted reason would have ended at the hash.
 */
function quotedScalar(text) {
  const quote = text.includes('"') ? "'" : '"';
  return `${quote}${text}${quote}`;
}

/**
 * Park an intent outside the queue: `pending` -> `blocked`, with the reason on the entry.
 *
 * The ledger could say an intent waits on another intent, and it could say nothing about one
 * waiting on the world. An intent that existed and could not be built yet had to sit on
 * `pending`, where every selection offered it, or stay out of the ledger and be forgotten.
 * `blocked` was already a parked status the drift check tolerates, and nothing could write it.
 *
 * The reason is required. A blocked intent with no reason is a note nobody can act on, and
 * nobody can tell later whether the thing it waited for has happened.
 *
 * An `in_progress` intent is refused rather than parked. A run holds it, along with its
 * worktree and its branch, and parking it under the run would leave that run building an
 * intent the ledger says nobody may build. `unclaim-intent` releases it first.
 */
function blockIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  // Free text a person types, folded to one line. The ledger is written line by line, so a
  // second line would land outside the entry's fields.
  const reason = String(options.reason || '').replace(/\s+/g, ' ').trim();
  if (!reason) {
    throw new TransitionError(
      'refusing to block an intent with no reason: nobody can tell later whether the wait is ' +
        `over. Say what it waits on: block-intent --intent ${options.intent} ` +
        '--reason "<why it cannot be built yet>".',
      'NO_REASON'
    );
  }

  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const previous = statusOf(lines, intent);

  if (previous === 'blocked') {
    return { changed: false, intent: options.intent, status: 'blocked', note: 'already blocked' };
  }
  if (previous !== 'pending') {
    const fix =
      previous === 'in_progress'
        ? ` A run holds it. Release it first: unclaim-intent --intent ${options.intent}.`
        : '';
    throw new TransitionError(
      `refusing to block ${options.intent}: status is ${previous || 'unset'}, not pending.${fix}`,
      'NOT_PENDING'
    );
  }

  const blockedAt = nowIso(options.now);
  // Each insert lands directly under `status:`, so write the pair back to front to leave the
  // ledger's own order: blocked_at, then blocked_reason.
  setField(lines, intent, 'status', 'blocked');
  setField(lines, intent, 'blocked_reason', quotedScalar(reason));
  setField(lines, intent, 'blocked_at', blockedAt);
  writeState(file, lines);

  return {
    changed: true,
    intent: options.intent,
    status: 'blocked',
    previous,
    blocked_at: blockedAt,
    reason,
  };
}

/**
 * Return a parked intent to the queue: `blocked` -> `pending`, both block fields removed.
 *
 * The mirror of block-intent, the way unclaim-intent gives a claim back. Both fields go rather
 * than stay as history. A `blocked_reason` under a pending intent reads as a live one, and why
 * the wait ended belongs in the entry comment a person writes.
 */
function unblockIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const previous = statusOf(lines, intent);

  if (previous === 'pending') {
    return { changed: false, intent: options.intent, status: 'pending', note: 'not blocked' };
  }
  if (previous !== 'blocked') {
    throw new TransitionError(
      `refusing to unblock ${options.intent}: status is ${previous || 'unset'}, not blocked.`,
      'NOT_BLOCKED'
    );
  }

  setField(lines, intent, 'status', 'pending');
  removeField(lines, intent, 'blocked_at');
  removeField(lines, intent, 'blocked_reason');
  writeState(file, lines);

  return { changed: true, intent: options.intent, status: 'pending', previous };
}

module.exports = { blockIntent, unblockIntent };
