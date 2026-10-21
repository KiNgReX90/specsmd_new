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
 * intents shipped). A small change is built directly and anything larger is an intent, because
 * the test is the builder's context (2026-10-21, replacing "an intent is the exception" of
 * 2026-09-06): an intent says on an INTENT. line what makes it more than one compact change,
 * and the ledger is the only queue.
 */

const fs = require('fs');
const path = require('path');
const {
  loadState, locateIntents, locateWorkItems, getIntent, statusOf, isComplete, isOpen,
} = require('./state-ledger.cjs');
const { archivePaths, archivedIds } = require('./state-archive.cjs');
const { closeIntentCall } = require('./run-call.cjs');
const {
  FIX, REINSTALL, capturedBeforeCriterionRule, criterionRuleSince, namedCriteria,
} = require('./state-criterion.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

/**
 * The `INTENT.` line of an intent's entry comment: what makes this work more than one compact
 * change a builder finishes directly. `BOX.` is the line's older name and `CROSS-INTENT.` is the
 * form a dependency chain took, and all three are read. A ledger writes its entry comment
 * either as free text inside a block scalar or as real YAML `#` comments, so the line is
 * accepted with or without the hash. The reason is the whole point of the line, so the
 * keyword on its own does not count: at least one word has to follow it. From the criterion
 * cutover on, a line counts as the reason only when it opens with a criterion letter, under
 * any of the three keywords: a chain across intents is criterion (c) and says so.
 */
const REASON_LINE = /^\s*(?:#\s*)?(?:BOX|CROSS-INTENT|INTENT)\.\s*(\S.*)$/;

function reasonLines(lines, intent) {
  const found = [];
  for (let i = intent.start; i < intent.end; i += 1) {
    const match = REASON_LINE.exec(lines[i]);
    if (match) found.push(match[1].trim());
  }
  return found;
}

/**
 * The vocabulary of size. Two mechanisms, six files and thirty rounds say how big the work is
 * and not what the batch is, so a reason built out of these words alone names nothing: it is
 * the shape the triage keeps producing when an intent is easier to write than a build is to run.
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
 * The rule an entry captured before the criterion cutover is held to: the first reason line
 * counts, and it has to say more than size. Null when the entry passes.
 */
function reasonDrift(reasons) {
  if (reasons.length === 0) {
    return 'no INTENT. line with a reason after it in the entry comment. Say what makes it more ' +
      'than one compact change (a batch of findings or changes across more than one screen, ' +
      'module or concern, a dependency chain no single dispatch can carry, disjoint ownership ' +
      'worth running builders in parallel, or a change that must not reach the branch before ' +
      'the full gate proves it whole), or hand it to a builder directly and drop the intent.';
  }
  if (!onlyRestatesSize(reasons[0])) return null;
  return `the INTENT. reason only restates size: "${reasons[0]}". Two mechanisms and six files do ` +
    'not name what the batch is. Name the findings, cards, screens or concerns that fill a ' +
    'builder\'s context, or hand it to a builder directly and drop the intent.';
}

/**
 * The rule from the cutover on: one reason line opens with the letter of a triage criterion
 * and carries a clause that says more than size. A line that names no criterion is a note, so
 * a note beside the reason never hides it. Null when the entry passes.
 */
function criterionDrift(reasons, since) {
  const hint = since === null ? ` ${REINSTALL}` : '';
  if (reasons.length === 0) {
    return `no INTENT. line with a reason after it in the entry comment. ${FIX}${hint}`;
  }
  const named = reasons.map((reason) => ({ reason, ...namedCriteria(reason) })).filter((line) => line.letters.length > 0);
  if (named.some((line) => !onlyRestatesSize(line.clause))) return null;
  if (named.length > 0) {
    return `the INTENT. reason only restates size: "${named[0].reason}". Two mechanisms and six files do ` +
      `not name what the batch is. Say what the criterion rests on, or drop the intent and return it as a direct build.${hint}`;
  }
  const reason = reasons[reasons.length - 1];
  return `the INTENT. reason names no criterion: "${reason}". A request, an order, a preference or a ` +
    `deadline is not one, whoever it comes from. ${FIX}${hint}`;
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
  // Read once, and only when an intent waits: the answer costs a git call.
  let cutover;
  const criterionSince = () => {
    if (cutover === undefined) cutover = criterionRuleSince(file);
    return cutover;
  };
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
          `Close it with: ${closeIntentCall(intent.id)}`,
      });
    }

    // The test is the builder's context, so every intent waiting to be claimed says what makes
    // it more than one compact change a builder could do.
    // The check is a capture-time gate: an intent a run already holds is being built, and
    // reporting it then would only block its own close.
    if (intentStatus === 'pending') {
      const since = criterionSince();
      const detail = capturedBeforeCriterionRule(lines, intent, since)
        ? reasonDrift(reasonLines(lines, intent))
        : criterionDrift(reasonLines(lines, intent), since);
      if (detail) drift.push({ intent: intent.id, kind: 'intent-without-exception-reason', detail });
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
