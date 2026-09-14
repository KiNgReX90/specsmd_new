#!/usr/bin/env node
'use strict';

/**
 * INFERNO single-writer for `.specs-inferno/state.yaml` status transitions.
 *
 * Why this exists: every status transition used to be free-hand prose ("update INFERNO
 * state"), so an orchestrator that dispatched, integrated and committed correctly still
 * left items on `pending`. The run succeeded from session memory while the ledger
 * silently rotted, and nothing ever read it back. This makes the transition mechanical,
 * idempotent, and checkable.
 *
 * Two constraints shape the implementation:
 *   1. ZERO dependencies. It runs inside consumer projects (Rust, static sites, anything)
 *      that have no node_modules. Node stdlib only.
 *   2. SURGICAL line edits, never parse -> re-serialize. Real state.yaml files carry
 *      load-bearing comment blocks (completion notes, capture rationale), and a whole-file
 *      rewrite both destroys them and turns every transition into a merge conflict against
 *      concurrent sessions. Touch only the lines that change.
 *
 * Commands:
 *   complete-item  --intent <id> --item <id>  mark one work item completed (+ completed_at)
 *   close-intent   --intent <id>              close the intent; refuses unless every work
 *                                             item is already completed
 *   block-intent   --intent <id> --reason <w> park a pending intent outside the queue
 *   unblock-intent --intent <id>              return a parked intent to the queue
 *   check [--intent <id>]                     report ledger drift; exit 1 if any found
 *
 * `check` itself lives in state-check.cjs, the reader beside this writer, and is re-exported
 * here so the CLI and every caller keep one entry point.
 */

const fs = require('fs');
const path = require('path');
const {
  TransitionError, unquote, findKeyLine, loadState, locateIntents, locateWorkItems,
  getIntent, statusOf, isComplete, setField, removeField, nowIso, writeState,
} = require('./state-ledger.cjs');
const { listValues } = require('./state-lists.cjs');
const { archiveIntent, archivePaths, archivedIds } = require('./state-archive.cjs');
const { check } = require('./state-check.cjs');
const { blockIntent, unblockIntent } = require('./state-block.cjs');
const { main: runCli } = require('./state-cli.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

// ---------------------------------------------------------------------------
// Work-item markdown frontmatter (secondary, best-effort)
// ---------------------------------------------------------------------------

/**
 * The work-item .md carries a duplicate `status:` that only a human reads. It was written
 * once at planning and never updated, so it reads `pending` forever. Sync it so the artifact
 * stops lying. Best-effort by design: a missing or unparsable file never fails the
 * transition, because state.yaml is the ledger.
 */
function syncWorkItemMarkdown(stateFile, intentId, itemId, status, completedAt) {
  const specsDir = path.dirname(path.resolve(stateFile));
  const mdPath = path.join(specsDir, 'intents', intentId, 'work-items', `${itemId}.md`);
  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, 'utf8');
  if (!content.startsWith('---\n')) return null;
  const closing = content.indexOf('\n---', '---\n'.length - 1);
  if (closing === -1) return null;

  const head = content.slice('---\n'.length, closing);
  const rest = content.slice(closing);
  const headLines = head.split('\n');

  const statusIdx = headLines.findIndex((line) => /^status:/.test(line));
  if (statusIdx === -1) return null;
  headLines[statusIdx] = `status: ${status}`;

  const completedIdx = headLines.findIndex((line) => /^completed_at:/.test(line));
  if (completedIdx !== -1) headLines[completedIdx] = `completed_at: ${completedAt}`;
  else headLines.splice(statusIdx + 1, 0, `completed_at: ${completedAt}`);

  fs.writeFileSync(mdPath, `---\n${headLines.join('\n')}${rest}`, 'utf8');
  return path.relative(path.dirname(specsDir), mdPath);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Set several fields on one entry, keeping the entry's own line range in step with the inserts. */
function setFields(lines, entry, pairs) {
  for (const [key, value] of pairs) {
    const before = lines.length;
    setField(lines, entry, key, value);
    entry.end += lines.length - before;
  }
}

/**
 * Mark one work item completed, with the proof that something verified it.
 *
 * The proof is the sha `run.cjs integrate` ran the checks on, and integrate is the only
 * caller that has one. Completion used to be written before integrate ran, so a run that
 * died in between left a ledger claiming verified about a tree nothing had verified, and the
 * next run released the successor on top of it (2026-09-09).
 */
function completeItem(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const items = locateWorkItems(lines, intent);
  const item = items.find((entry) => entry.id === options.item);

  if (!item) {
    const known = items.map((entry) => entry.id).join(', ') || '(none)';
    throw new TransitionError(
      `work item not found: ${options.item} in intent ${options.intent}. Known items: ${known}`,
      'ITEM_NOT_FOUND'
    );
  }

  const proof = options.proof ? String(options.proof).trim() : '';
  if (!proof) {
    throw new TransitionError(
      `refusing to complete ${options.item} with no integration proof. An item is completed by its ` +
        `integration, never before it: run.cjs integrate --item ${options.item} --tree <worktree> folds the ` +
        'base in, runs the checks on the committed tree, and completes the item with the sha they proved.',
      'NO_PROOF'
    );
  }

  const previous = statusOf(lines, item);
  const proven = findKeyLine(lines, item.start, item.end, item.keyIndent, 'integrated_sha') !== -1;
  if (isComplete(previous) && proven) {
    return { changed: false, item: options.item, status: 'completed', note: 'already completed' };
  }

  const completedAt = nowIso(options.now);
  setFields(lines, item, [
    ['integrated_sha', proof],
    ['integrated_at', completedAt],
    ['completed_at', completedAt],
    ['status', 'completed'],
  ]);
  writeState(file, lines);

  const markdown = syncWorkItemMarkdown(file, options.intent, options.item, 'completed', completedAt);
  return {
    changed: true,
    item: options.item,
    status: 'completed',
    previous,
    completed_at: completedAt,
    integrated_at: completedAt,
    integrated_sha: proof,
    markdown,
  };
}

function closeIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const items = locateWorkItems(lines, intent);

  // The guard that makes "intent completed over pending items" unrepresentable.
  const outstanding = items
    .map((item) => ({ id: item.id, status: statusOf(lines, item) }))
    .filter((item) => !isComplete(item.status));

  if (outstanding.length > 0) {
    const detail = outstanding.map((item) => `${item.id} (${item.status || 'no status'})`).join(', ');
    throw new TransitionError(
      `refusing to close ${options.intent}: ${outstanding.length} work item(s) not completed: ${detail}. ` +
        `Complete each with: complete-item --intent ${options.intent} --item <id>`,
      'ITEMS_OUTSTANDING'
    );
  }

  const previous = statusOf(lines, intent);
  if (isComplete(previous)) {
    return { changed: false, intent: options.intent, status: 'completed', note: 'already completed' };
  }

  const completedAt = nowIso(options.now);
  setField(lines, intent, 'status', 'completed');
  setField(lines, intent, 'completed_at', completedAt);
  removeField(lines, intent, 'claimed_by');
  writeState(file, lines);

  return { changed: true, intent: options.intent, status: 'completed', previous, completed_at: completedAt, items: items.length };
}

/** Read either supported sequence form through the shared parser. */
function dependsOnIntents(lines, intent) {
  return listValues(lines, intent, 'depends_on_intents');
}

/**
 * Take the intent for one run: `pending` -> `in_progress`, with the run recorded.
 *
 * This is the transition that stops two sessions building the same intent, so it is a
 * refusal first and a write second. It refuses an intent another run holds, and it refuses
 * one whose prerequisites have not shipped; both were prose rules an orchestrator could
 * read past. `claimed_by` carries the run id (the branch the run will use), which is what
 * makes the claim idempotent for the run that already holds it.
 *
 * A prerequisite id the ledger does not answer to counts as met: an archived intent is
 * removed from the live ledger by design, so refusing it would make every intent whose
 * prerequisite shipped permanently unclaimable.
 */
function claimIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const previous = statusOf(lines, intent);

  if (previous !== 'pending') {
    const holderIdx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'claimed_by');
    const held =
      holderIdx === -1
        ? null
        : unquote(lines[holderIdx].slice(intent.keyIndent + 'claimed_by:'.length));
    if (options.run && held === options.run) {
      return {
        changed: false,
        intent: options.intent,
        status: previous,
        run: held,
        note: 'already claimed by this run',
      };
    }
    throw new TransitionError(
      `refusing to claim ${options.intent}: status is ${previous || 'unset'}, not pending` +
        `${held ? ` (held by ${held})` : ''}.`,
      'NOT_PENDING'
    );
  }

  const known = new Map(locateIntents(lines).map((entry) => [entry.id, statusOf(lines, entry)]));
  const archived = archivedIds(archivePaths(file).archiveFile);
  const prerequisites = dependsOnIntents(lines, intent);
  // An id neither the ledger nor the archive answers to is a name, not a prerequisite. It used
  // to count as shipped, so a misspelled dependency claimed the intent and built on nothing.
  const unknown = prerequisites.filter((id) => !known.has(id) && !archived.has(id));
  if (unknown.length > 0) {
    throw new TransitionError(
      `refusing to claim ${options.intent}: prerequisite intent(s) in neither the live ledger nor the ` +
        `archive: ${unknown.join(', ')}. Fix the name in depends_on_intents, or drop the dependency.`,
      'DEPENDS_UNKNOWN'
    );
  }
  const unmet = prerequisites.filter((id) => known.has(id) && !isComplete(known.get(id)));
  if (unmet.length > 0) {
    throw new TransitionError(
      `refusing to claim ${options.intent}: prerequisite intent(s) not completed: ` +
        `${unmet.join(', ')}. Build those first.`,
      'DEPENDS_UNMET'
    );
  }

  const claimedAt = nowIso(options.now);
  // Each insert lands directly under `status:`, so write the pair back to front to leave
  // the ledger's own order: claimed_at, then claimed_by.
  setField(lines, intent, 'status', 'in_progress');
  if (options.run) setField(lines, intent, 'claimed_by', options.run);
  setField(lines, intent, 'claimed_at', claimedAt);
  writeState(file, lines);

  return {
    changed: true,
    intent: options.intent,
    status: 'in_progress',
    previous,
    claimed_at: claimedAt,
    run: options.run || null,
  };
}

/** Give the intent back: `in_progress` -> `pending`, claim fields removed. */
function unclaimIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const previous = statusOf(lines, intent);

  if (previous === 'pending') {
    return { changed: false, intent: options.intent, status: 'pending', note: 'not claimed' };
  }
  if (previous !== 'in_progress') {
    throw new TransitionError(
      `refusing to unclaim ${options.intent}: status is ${previous || 'unset'}, not in_progress.`,
      'NOT_CLAIMED'
    );
  }

  setField(lines, intent, 'status', 'pending');
  removeField(lines, intent, 'claimed_at');
  removeField(lines, intent, 'claimed_by');
  writeState(file, lines);

  return { changed: true, intent: options.intent, status: 'pending', previous };
}

function main(argv) {
  return runCli(argv, {
    claimIntent, unclaimIntent, blockIntent, unblockIntent, completeItem, closeIntent,
    archiveIntent, check,
  });
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof TransitionError) {
      process.stderr.write(`ERROR [${error.code}] ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}

module.exports = {
  completeItem,
  closeIntent,
  archiveIntent,
  claimIntent,
  unclaimIntent,
  blockIntent,
  unblockIntent,
  check,
  TransitionError,
  main,
  // Read-only primitives, so a sibling script reads the ledger the way this one writes it
  // instead of growing a second, subtly different YAML reader beside it.
  loadState,
  locateIntents,
  locateWorkItems,
  statusOf,
  dependsOnIntents,
  isComplete,
  unquote,
  findKeyLine,
};
