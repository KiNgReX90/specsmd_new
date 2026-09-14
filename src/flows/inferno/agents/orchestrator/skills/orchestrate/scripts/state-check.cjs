'use strict';

/**
 * Ledger drift detection for `.specs-inferno/state.yaml`. The reader beside the single writer.
 *
 * `state-transition.cjs` performs every status change and this file decides whether the
 * result still makes sense. It never writes. It was split out of the writer on 2026-09-10,
 * when that file stood at the ceiling with two transitions owed. The boundary is the one the
 * two names already draw. A transition mutates one entry and a check reads every entry.
 *
 * `check` also refuses a parking file: `.specs-inferno/quick-fixes.md` beside the ledger is
 * drift on its own. Nothing reads that file, so work written there is never built (three
 * entries captured on 2026-08-27 beside five intents were untouched on 2026-08-30 while the
 * intents shipped). Work is built directly and an intent is the exception (2026-09-06): a
 * one-item intent has to say on an INTENT. line why one builder on the default branch could
 * not do it, and the ledger is the only queue.
 */

const fs = require('fs');
const path = require('path');
const {
  loadState, locateIntents, locateWorkItems, getIntent, statusOf, isComplete, isOpen,
} = require('./state-ledger.cjs');
const { archivePaths, archivedIds } = require('./state-archive.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

/**
 * The `INTENT.` line of an intent's entry comment: why one builder on the default branch
 * could not do this work directly. `BOX.` is the line's older name and `CROSS-INTENT.` is the
 * form a dependency chain takes, and both still count. A ledger writes its entry comment
 * either as free text inside a block scalar or as real YAML `#` comments, so the line is
 * accepted with or without the hash. The reason is the whole point of the line, so the
 * keyword on its own does not count: at least one word has to follow it.
 */
const REASON_LINE = /^\s*(?:#\s*)?(?:BOX|CROSS-INTENT|INTENT)\.\s*(\S.*)$/;

function exceptionReason(lines, intent) {
  for (let i = intent.start; i < intent.end; i += 1) {
    const match = REASON_LINE.exec(lines[i]);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * The vocabulary of size. Two mechanisms, six files and thirty rounds are a batched dispatch,
 * so a reason built out of these words alone names no exception at all: it is the shape the
 * triage keeps producing when an intent is easier to write than a build is to run.
 */
const SIZE_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'big', 'builder', 'builders', 'ceiling', 'eight', 'file',
  'files', 'five', 'four', 'is', 'it', 'item', 'items', 'large', 'lines', 'many', 'mechanism',
  'mechanisms', 'more', 'multiple', 'nine', 'of', 'one', 'or', 'over', 'past', 'plus', 'round',
  'rounds', 'seven', 'several', 'six', 'size', 'small', 'surface', 'surfaces', 'ten', 'than',
  'that', 'the', 'thirty', 'this', 'three', 'too', 'twenty', 'two', 'with', 'work',
]);

function onlyRestatesSize(reason) {
  const words = (reason.toLowerCase().match(/[a-z][a-z-]*/g) || []);
  if (words.length < 5) return true;
  return words.every((word) => SIZE_WORDS.has(word));
}

/**
 * Detect ledger drift. This is the check that never existed: a run could finish, merge and
 * push while state.yaml still read `pending`, and nothing anywhere would notice.
 */
function check(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const entries = locateIntents(lines);
  const scope = options.intent ? entries.filter((entry) => entry.id === options.intent) : entries;
  if (options.intent && scope.length === 0) {
    // Finalize runs check after archive-intent has moved the block out of the live ledger:
    // an archived intent is a finished one, not an unknown one (2026-09-03).
    if (archivedIds(archivePaths(file).archiveFile).has(options.intent)) {
      return { drift: [], intents: 0, archived: options.intent };
    }
    getIntent(lines, options.intent);
  }

  const drift = [];
  for (const intent of scope) {
    const intentStatus = statusOf(lines, intent);
    const items = locateWorkItems(lines, intent).map((item) => ({ id: item.id, status: statusOf(lines, item) }));
    if (items.length === 0) continue;

    const open = items.filter((item) => isOpen(item.status));

    if (isComplete(intentStatus) && open.length > 0) {
      drift.push({
        intent: intent.id,
        kind: 'intent-completed-over-open-items',
        detail: `intent is ${intentStatus} but ${open.length}/${items.length} work items are still open: ` +
          open.map((item) => `${item.id} (${item.status || 'no status'})`).join(', '),
      });
    }

    // A parked intent (superseded, on_hold, awaiting-manual) is a deliberate resting
    // place, not a missed close. only genuinely open intents can drift this way.
    if (isOpen(intentStatus) && open.length === 0) {
      drift.push({
        intent: intent.id,
        kind: 'all-items-completed-intent-open',
        detail: `all ${items.length} work items are completed but the intent is ${intentStatus || 'unset'}. ` +
          `Close it with: close-intent --intent ${intent.id}`,
      });
    }

    // Work is built directly and an intent is the exception, whatever its size, so every
    // intent waiting to be claimed says why one builder on the default branch could not do
    // it. The check is a capture-time gate: an intent a run already holds is being built, and
    // reporting it then would only block its own close.
    if (intentStatus === 'pending') {
      const reason = exceptionReason(lines, intent);
      if (reason === null) {
        drift.push({
          intent: intent.id,
          kind: 'intent-without-exception-reason',
          detail: 'no INTENT. line with a reason after it in the entry comment. Say why one builder ' +
            'on the default branch could not do it (a dependency chain no single dispatch can carry, ' +
            'disjoint ownership worth running builders in parallel, or a change that must not reach ' +
            'the branch before the full gate proves it whole), or hand it to a builder directly and ' +
            'drop the intent.',
        });
      } else if (onlyRestatesSize(reason)) {
        drift.push({
          intent: intent.id,
          kind: 'intent-without-exception-reason',
          detail: `the INTENT. reason only restates size: "${reason}". Two mechanisms and six files are ` +
            'one batched dispatch, not an intent. Name what one builder on the default branch could ' +
            'not do, or hand it to a builder directly and drop the intent.',
        });
      }
    }
  }

  // A parking file beside the ledger is drift on its own. Nothing reads it, so work written
  // there is never built: three entries captured on 2026-08-27 beside five intents were
  // untouched on 2026-08-30 while the intents shipped. A one-item request that leaves the
  // ledger is a one-item intent with its reason, and everything else is a direct build (planner
  // intent-capture step 3c), and the ledger is the only queue.
  const parked = path.join(path.dirname(file), 'quick-fixes.md');
  if (fs.existsSync(parked)) {
    drift.push({
      intent: 'ledger',
      kind: 'quick-fixes-file-present',
      detail: `${parked} exists. Nothing builds from it: hand each entry to a builder directly ` +
        'and delete the file.',
    });
  }
  return { drift, intents: scope.length };
}

module.exports = { check };
