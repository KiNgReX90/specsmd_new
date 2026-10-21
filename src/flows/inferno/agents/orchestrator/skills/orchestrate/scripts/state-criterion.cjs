'use strict';

/**
 * The criterion an intent's reason has to name, and the moment that rule started on a host.
 *
 * The test for an intent is the builder's context: a small change is built directly and anything
 * larger is an intent (2026-10-21, replacing "an intent is the exception"). The planner's triage
 * allows an intent under four criteria and gives each a letter. A reason in free text let a request
 * pass as a reason: "ordered as intents" is more than size, so the size check accepted it.
 * The reason therefore opens with the letter of the criterion that holds, and a reason that
 * names none is refused whatever else it says. Who asked for the intent is never a criterion.
 *
 * The rule starts per host, at the install that first carried it. An entry captured before
 * that moment was written under the rule of its day and keeps the answer it had then.
 */

const path = require('path');
const { findKeyLine, unquote } = require('./state-ledger.cjs');
const { lockRule, ruleSince } = require('./flow-lock-rules.cjs');

/** The triage criteria, by the letter the planner gives each. */
const CRITERIA = {
  a: 'a batch of findings, cards, or changes across more than one screen, module or concern',
  c: 'a dependency chain where a later change cannot be tested before an earlier one lands',
  d: 'disjoint ownership worth running builders in parallel on disjoint compile trees',
  e: 'a change that must not reach the default branch before the full gate proves it whole',
};

/** The form the refusal asks for, and what it says when no criterion holds. */
const FIX = 'Open the reason with the letter of the criterion that holds, as in "INTENT. (c) <what cannot ' +
  `be tested before what lands>": ${Object.entries(CRITERIA).map(([letter, text]) => `(${letter}) ${text}`).join(', ')}. ` +
  'When none holds, drop the intent and return it as a direct build.';

/** What a host with no recorded cutover is told on every refusal the rule makes. */
const REINSTALL = 'This host\'s .specsmd/inferno/flow.lock records no triage cutover, so every waiting intent ' +
  'owes a criterion: reinstall the flow to record it, and intents captured before that keep the old rule.';

/** One or more letters in parentheses, joined by commas or "and", then the clause they carry. */
const LETTERS = /^((?:\([a-z]\)(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+)?)+)\s*[:.]?\s*(.*)$/;

/**
 * The criteria a reason names and the clause after them. `letters` is empty when the reason
 * opens with no letter the triage carries.
 */
function namedCriteria(reason) {
  const match = LETTERS.exec(reason);
  if (!match) return { letters: [], clause: reason };
  const letters = (match[1].match(/[a-z]/g) || []).filter((letter) => letter in CRITERIA);
  return { letters, clause: match[2].trim() };
}

/**
 * When the criterion rule started for the ledger at `stateFile`. The primary checkout's lock
 * answers first. A worktree that already carries the rule beside a primary that does not yet
 * answers from its own lock, so the two never disagree about an entry both can see.
 */
function criterionRuleSince(stateFile) {
  const root = path.dirname(path.dirname(path.resolve(stateFile)));
  const since = ruleSince(root, 'triage');
  return since === null ? lockRule(root, 'triage') : since;
}

/**
 * Whether an intent was captured before the rule started on this host. An entry with no
 * readable `created` cannot show that it was, so it is held to the rule.
 */
function capturedBeforeCriterionRule(lines, intent, since) {
  if (since === null) return false;
  const at = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'created');
  if (at === -1) return false;
  const created = Date.parse(unquote(lines[at].slice(intent.keyIndent + 'created:'.length)));
  return !Number.isNaN(created) && created < since;
}

module.exports = { FIX, REINSTALL, capturedBeforeCriterionRule, criterionRuleSince, namedCriteria };
