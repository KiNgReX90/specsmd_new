#!/usr/bin/env node
'use strict';

/**
 * INFERNO single-writer for `.specs-inferno/state.yaml` status transitions.
 *
 * Why this exists: every status transition used to be free-hand prose ("update INFERNO
 * state"), so an orchestrator that dispatched, integrated and committed correctly still
 * left items on `pending` — the run succeeded from session memory while the ledger
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
 *   complete-item --intent <id> --item <id>   mark one work item completed (+ completed_at)
 *   close-intent  --intent <id>               close the intent; refuses unless every work
 *                                             item is already completed
 *   check [--intent <id>]                     report ledger drift; exit 1 if any found
 *
 * `check` also refuses a parking file: `.specs-inferno/quick-fixes.md` beside the ledger is
 * drift on its own. Nothing reads that file, so work written there is never built (three
 * entries captured on 2026-08-27 beside five intents were untouched on 2026-08-30 while the
 * intents shipped). A one-item request is a one-item intent; the ledger is the only queue.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

// `done` is not our vocabulary, but existing projects seeded their ledger with it.
// Accept it as terminal on read so this script is usable there; always WRITE `completed`.
const COMPLETE_VALUES = new Set(['completed', 'done']);

// Statuses are three-way, not two-way. A ledger in the wild also carries deliberately
// PARKED entries — `superseded` (replaced by another approach), `on_hold`, `blocked`,
// `awaiting-manual` (code done, a human step remains). Those are neither complete nor
// active work: reporting them as drift is a false positive, and since finalize blocks on a
// non-zero `check`, that noise would stall closes. Only `pending`/`in_progress` are OPEN.
const PARKED_VALUES = new Set(['superseded', 'on_hold', 'blocked', 'awaiting-manual', 'cancelled', 'abandoned']);

class TransitionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransitionError';
    this.code = code || 'INFERNO_STATE_ERROR';
  }
}

// ---------------------------------------------------------------------------
// Line primitives
// ---------------------------------------------------------------------------

function indentOf(line) {
  const match = /^( *)/.exec(line);
  return match ? match[1].length : 0;
}

// Blank lines and comments never terminate a block: a trailing comment belongs to the
// entry it follows, which is how the planner writes capture and completion notes.
function isSkippable(line) {
  return /^\s*$/.test(line) || /^\s*#/.test(line);
}

/** Strip a trailing ` # comment`, but not a '#' inside a quoted title. */
function stripInlineComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}

function unquote(value) {
  const trimmed = stripInlineComment(value).trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** Index of `<indent><key>:` within [from, to), matching the key indent EXACTLY. */
function findKeyLine(lines, from, to, indent, key) {
  const pattern = new RegExp(`^ {${indent}}${key}:`);
  for (let i = from; i < to; i += 1) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

/**
 * List `- id: <value>` entries at `dashIndent` within [from, to). An entry runs until the
 * next entry at the same indent, or the next non-blank non-comment line at a shallower
 * indent — so comment blocks stay attached to the entry above them.
 */
function findEntries(lines, from, to, dashIndent) {
  const dashPattern = new RegExp(`^ {${dashIndent}}- id:`);
  const starts = [];
  for (let i = from; i < to; i += 1) {
    if (dashPattern.test(lines[i])) starts.push(i);
  }

  return starts.map((start, position) => {
    let end = to;
    const nextStart = starts[position + 1];
    if (nextStart !== undefined) {
      end = nextStart;
    } else {
      for (let i = start + 1; i < to; i += 1) {
        if (isSkippable(lines[i])) continue;
        if (indentOf(lines[i]) <= dashIndent) {
          end = i;
          break;
        }
      }
    }
    while (end - 1 > start && /^\s*$/.test(lines[end - 1])) end -= 1;

    const id = unquote(lines[start].slice(lines[start].indexOf('- id:') + '- id:'.length));
    return { id, start, end, keyIndent: dashIndent + 2 };
  });
}

// ---------------------------------------------------------------------------
// state.yaml structure
// ---------------------------------------------------------------------------

function loadState(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new TransitionError(`state file not found: ${filePath}`, 'STATE_MISSING');
  }
  return fs.readFileSync(filePath, 'utf8').split('\n');
}

/** Find the first `- id:` dash indent inside a block, or null when the block is empty. */
function firstDashIndent(lines, from, to, ceilingIndent) {
  for (let i = from; i < to; i += 1) {
    if (isSkippable(lines[i])) continue;
    const indent = indentOf(lines[i]);
    if (indent <= ceilingIndent) return null;
    if (/^ *- id:/.test(lines[i])) return indent;
  }
  return null;
}

function locateIntents(lines) {
  const idx = lines.findIndex((line) => /^intents:\s*$/.test(line));
  if (idx === -1) {
    throw new TransitionError('no top-level `intents:` key in state file', 'NO_INTENTS');
  }

  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i += 1) {
    if (isSkippable(lines[i])) continue;
    if (indentOf(lines[i]) === 0) {
      end = i;
      break;
    }
  }

  const dashIndent = firstDashIndent(lines, idx + 1, end, -1);
  if (dashIndent === null) return [];
  return findEntries(lines, idx + 1, end, dashIndent);
}

function locateWorkItems(lines, intent) {
  const wiIdx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'work_items');
  if (wiIdx === -1) return [];
  const dashIndent = firstDashIndent(lines, wiIdx + 1, intent.end, intent.keyIndent);
  if (dashIndent === null) return [];
  return findEntries(lines, wiIdx + 1, intent.end, dashIndent);
}

function getIntent(lines, intentId) {
  const entries = locateIntents(lines);
  const intent = entries.find((entry) => entry.id === intentId);
  if (!intent) {
    const known = entries.map((entry) => entry.id).join(', ') || '(none)';
    throw new TransitionError(
      `intent not found: ${intentId}. Known intents: ${known}`,
      'INTENT_NOT_FOUND'
    );
  }
  return intent;
}

function statusOf(lines, entry) {
  const idx = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, 'status');
  return idx === -1 ? null : unquote(lines[idx].slice(entry.keyIndent + 'status:'.length));
}

function isComplete(status) {
  return COMPLETE_VALUES.has(status);
}

/** Active, unfinished work — the only thing `check` may call drift. */
function isOpen(status) {
  return !isComplete(status) && !PARKED_VALUES.has(status);
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/** Set `key` inside an entry; insert directly after `status:` when the key is absent. */
function setField(lines, entry, key, value) {
  const existing = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  const rendered = `${' '.repeat(entry.keyIndent)}${key}: ${value}`;
  if (existing !== -1) {
    lines[existing] = rendered;
    return;
  }
  const statusIdx = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, 'status');
  const anchor = statusIdx !== -1 ? statusIdx : entry.start;
  lines.splice(anchor + 1, 0, rendered);
}

function removeField(lines, entry, key) {
  const idx = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  if (idx !== -1) lines.splice(idx, 1);
}

function nowIso(override) {
  return override || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function writeState(filePath, lines) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

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

  const previous = statusOf(lines, item);
  if (isComplete(previous)) {
    return { changed: false, item: options.item, status: 'completed', note: 'already completed' };
  }

  const completedAt = nowIso(options.now);
  setField(lines, item, 'status', 'completed');
  setField(lines, item, 'completed_at', completedAt);
  writeState(file, lines);

  const markdown = syncWorkItemMarkdown(file, options.intent, options.item, 'completed', completedAt);
  return { changed: true, item: options.item, status: 'completed', previous, completed_at: completedAt, markdown };
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

/** The ids in an intent's inline `depends_on_intents: [a, b]`, or [] when it has none. */
function dependsOnIntents(lines, intent) {
  const idx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'depends_on_intents');
  if (idx === -1) return [];
  const raw = stripInlineComment(
    lines[idx].slice(intent.keyIndent + 'depends_on_intents:'.length)
  ).trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) {
    throw new TransitionError(
      `intent ${intent.id} does not write depends_on_intents as the inline [a, b] form: ` +
        `${raw || '(block sequence)'}`,
      'DEPENDS_FORM'
    );
  }
  return raw
    .slice(1, -1)
    .split(',')
    .map((value) => unquote(value))
    .filter((value) => value.length > 0);
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
  const unmet = dependsOnIntents(lines, intent).filter(
    (id) => known.has(id) && !isComplete(known.get(id))
  );
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
    // place, not a missed close — only genuinely open intents can drift this way.
    if (isOpen(intentStatus) && open.length === 0) {
      drift.push({
        intent: intent.id,
        kind: 'all-items-completed-intent-open',
        detail: `all ${items.length} work items are completed but the intent is ${intentStatus || 'unset'}. ` +
          `Close it with: close-intent --intent ${intent.id}`,
      });
    }

  }

  // A parking file beside the ledger is drift on its own. Nothing reads it, so work written
  // there is never built: three entries captured on 2026-08-27 beside five intents were
  // untouched on 2026-08-30 while the intents shipped. A one-item request is a one-item
  // intent (planner intent-capture step 3c), and the ledger is the only queue.
  const parked = path.join(path.dirname(file), 'quick-fixes.md');
  if (fs.existsSync(parked)) {
    drift.push({
      intent: 'ledger',
      kind: 'quick-fixes-file-present',
      detail: `${parked} exists. Nothing builds from it: capture each entry as a one-item intent ` +
        'with the planner and delete the file.',
    });
  }
  return { drift, intents: scope.length };
}

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

const ARCHIVE_HEADER =
  '# Archived INFERNO intents: completed and merged. Historical record, never edited.\n' +
  '# Live state is ../state.yaml. Briefs and work items live in ./intents/<id>/.\n' +
  'intents:\n';

/** Where the archive lives, relative to the live state file. */
function archivePaths(stateFile) {
  const specsDir = path.dirname(path.resolve(stateFile));
  return {
    specsDir,
    archiveFile: path.join(specsDir, 'archive', 'state.yaml'),
    intentsDir: path.join(specsDir, 'intents'),
    archiveIntentsDir: path.join(specsDir, 'archive', 'intents'),
  };
}

/** The ids already in the archive, so a re-run reports "already archived" instead of duplicating. */
function archivedIds(archiveFile) {
  const ids = new Set();
  if (!fs.existsSync(archiveFile)) return ids;
  for (const line of fs.readFileSync(archiveFile, 'utf8').split('\n')) {
    const match = /^ *- id: (.+)$/.exec(line);
    if (match) ids.add(unquote(stripInlineComment(match[1])));
  }
  return ids;
}

/**
 * Intent ids another session is still shipping: a live `inferno-intent/<id>-<stamp>` branch
 * or a worktree named for one. The sweep leaves those alone, because archiving an intent
 * mid-ship rewrites the ledger under the session that owns it. A repo where git cannot
 * answer has no such branches to protect, so an empty set is the honest answer there.
 */
function shippingIds(stateFile) {
  const repo = path.dirname(path.dirname(path.resolve(stateFile)));
  const ids = new Set();
  let out = '';
  try {
    out += execFileSync('git', ['-C', repo, 'branch', '--list', 'inferno-intent/*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    out += execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    return ids;
  }
  for (const match of out.matchAll(/inferno-intent\/(.+?)-\d{8}/g)) ids.add(match[1]);
  return ids;
}

/**
 * Drop `ids` from an intent's inline `depends_on_intents: [a, b]`, returning what was freed.
 *
 * Inline is the only form the planner writes. A block sequence is refused loudly rather
 * than skipped: a dependency still pointing at an archived intent reads as an unmet
 * prerequisite forever, and a silent skip is how that would happen.
 */
function freeDependencies(lines, intent, ids) {
  const idx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'depends_on_intents');
  if (idx === -1) return [];
  const raw = stripInlineComment(
    lines[idx].slice(intent.keyIndent + 'depends_on_intents:'.length)
  ).trim();

  if (raw === '') {
    throw new TransitionError(
      `intent ${intent.id} writes depends_on_intents as a block sequence; this writer only ` +
        'edits the inline [a, b] form. Convert it inline, then re-run.',
      'DEPENDS_FORM'
    );
  }
  if (!raw.startsWith('[') || !raw.endsWith(']')) {
    throw new TransitionError(
      `intent ${intent.id} has an unreadable depends_on_intents value: ${raw}`,
      'DEPENDS_FORM'
    );
  }

  const current = raw
    .slice(1, -1)
    .split(',')
    .map((value) => unquote(value))
    .filter((value) => value.length > 0);
  const freed = current.filter((value) => ids.has(value));
  if (freed.length === 0) return [];

  const remaining = current.filter((value) => !ids.has(value));
  lines[idx] = `${' '.repeat(intent.keyIndent)}depends_on_intents: [${remaining.join(', ')}]`;
  return freed;
}

/**
 * Append one dated line to an intent's rationale, so a reader of a pending intent can see
 * why its prerequisite list shrank.
 *
 * Two shapes carry that rationale in the wild and both have to work: a `comment: |` literal
 * block, and a run of `#` lines under the entry's keys. Handling only the block form meant
 * that in a repo written the other way (Skoft_Files, every entry) a dependency vanished
 * from the list with no trace anywhere, which is precisely the drift this note exists to
 * prevent. An entry with neither shape gets no note; freeing the dependency is the
 * load-bearing half, the sentence is the courtesy.
 */
function noteFreedDependencies(lines, intent, freed, date) {
  const subject = freed.length === 1 ? `Prerequisite ${freed[0]}` : `Prerequisites ${freed.join(', ')}`;
  const sentence = `${subject} completed; record moved to archive/state.yaml on ${date}.`;

  const blockIdx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'comment');
  if (blockIdx !== -1) {
    let end = -1;
    let contentIndent = -1;
    for (let i = blockIdx + 1; i < intent.end; i += 1) {
      if (/^\s*$/.test(lines[i])) continue;
      if (indentOf(lines[i]) <= intent.keyIndent) break;
      if (contentIndent === -1) contentIndent = indentOf(lines[i]);
      end = i + 1;
    }
    if (end !== -1) {
      lines.splice(end, 0, `${' '.repeat(contentIndent)}${sentence}`);
      return true;
    }
  }

  // Hash form: land at the end of the comment run that follows the dependency line, which
  // is where these files keep the entry's prose, and never inside `work_items:`.
  const depsIdx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'depends_on_intents');
  if (depsIdx === -1) return false;
  let end = depsIdx + 1;
  while (end < intent.end && /^\s*#/.test(lines[end])) end += 1;
  if (end === depsIdx + 1) return false;
  lines.splice(end, 0, `${' '.repeat(intent.keyIndent)}# ${sentence}`);
  return true;
}

/** Move `.specs-inferno/intents/<id>` under `archive/intents/`, tolerating a half-done move. */
function moveIntentDirectory(paths, id) {
  const from = path.join(paths.intentsDir, id);
  const to = path.join(paths.archiveIntentsDir, id);
  if (fs.existsSync(to)) return fs.existsSync(from) ? 'both' : 'already';
  if (!fs.existsSync(from)) return 'absent';
  fs.mkdirSync(paths.archiveIntentsDir, { recursive: true });
  fs.renameSync(from, to);
  return 'moved';
}

/** Append blocks under the archive's `intents:` key, creating the file when absent. */
function appendToArchive(archiveFile, blocks) {
  fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
  let existing = fs.existsSync(archiveFile)
    ? fs.readFileSync(archiveFile, 'utf8')
    : ARCHIVE_HEADER;
  if (!/^intents:\s*$/m.test(existing)) {
    throw new TransitionError(`archive file has no top-level \`intents:\` key: ${archiveFile}`, 'NO_INTENTS');
  }
  if (!existing.endsWith('\n')) existing += '\n';
  fs.writeFileSync(archiveFile, `${existing}${blocks.join('\n')}\n`, 'utf8');
}

/**
 * Move completed intents out of the live ledger into `archive/state.yaml`, byte for byte.
 *
 * Why this is a command and not prose: the live state is what a session reads to see what
 * is left, and completed intents pile up in it invisibly. `/ship-intent` archived by hand,
 * but the orchestrator's own finalize had no archive step at all, so every intent that
 * closed through auto-close stayed in the live ledger for good. By the time anyone looked
 * (2026-08-25) that was 17 completed intents in one repo and 81 in another. Hand-moving a
 * YAML block is exactly the surgery that drops a comment or flips a status, which is why it
 * belongs to the single writer rather than to a procedure step.
 *
 * `--intent <id>` archives the caller's own intent with no live-branch guard: the caller is
 * standing on that branch, so the guard would refuse the one case that is always safe.
 * `--sweep` adds every other completed intent EXCEPT the ones another session is shipping.
 */
function archiveIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const paths = archivePaths(file);
  const lines = loadState(file);
  const entries = locateIntents(lines);
  const targets = [];
  const skipped = [];

  if (options.intent) {
    const named = entries.find((entry) => entry.id === options.intent);
    if (!named) {
      if (archivedIds(paths.archiveFile).has(options.intent)) {
        return { changed: false, archived: [], skipped, note: `${options.intent} already archived` };
      }
      getIntent(lines, options.intent);
    } else if (!isComplete(statusOf(lines, named))) {
      throw new TransitionError(
        `refusing to archive ${options.intent}: status is ${statusOf(lines, named) || 'unset'}, ` +
          `not completed. Close it first with: close-intent --intent ${options.intent}`,
        'NOT_COMPLETE'
      );
    } else {
      targets.push(named);
    }
  }

  if (options.sweep) {
    const shipping = shippingIds(file);
    for (const entry of entries) {
      if (targets.includes(entry)) continue;
      if (!isComplete(statusOf(lines, entry))) continue;
      if (shipping.has(entry.id)) {
        skipped.push(entry.id);
        continue;
      }
      targets.push(entry);
    }
  }

  if (targets.length === 0) {
    return { changed: false, archived: [], skipped, note: 'nothing to archive' };
  }

  const ids = new Set(targets.map((entry) => entry.id));
  const date = nowIso(options.now).slice(0, 10);

  // Free the dependents FIRST, while the blocks are still in place: every insert shifts the
  // lines below it, so re-locate after each note rather than trusting stale indexes.
  const freed = [];
  for (const entry of entries) {
    if (ids.has(entry.id)) continue;
    const current = locateIntents(lines).find((candidate) => candidate.id === entry.id);
    if (!current) continue;
    const dropped = freeDependencies(lines, current, ids);
    if (dropped.length === 0) continue;
    noteFreedDependencies(lines, current, dropped, date);
    freed.push({ intent: entry.id, freed: dropped });
  }

  // Cut back to front so an earlier block's indexes survive a later block's removal.
  const located = locateIntents(lines);
  const ordered = targets
    .map((entry) => located.find((candidate) => candidate.id === entry.id))
    .sort((a, b) => b.start - a.start);
  const cut = new Map();
  for (const entry of ordered) {
    cut.set(entry.id, lines.slice(entry.start, entry.end).join('\n'));
    lines.splice(entry.start, entry.end - entry.start);
  }

  appendToArchive(paths.archiveFile, targets.map((entry) => cut.get(entry.id)));
  writeState(file, lines);

  const directories = targets.map((entry) => ({
    intent: entry.id,
    result: moveIntentDirectory(paths, entry.id),
  }));

  return {
    changed: true,
    archived: targets.map((entry) => entry.id),
    skipped,
    freed,
    directories,
    archive: path.relative(path.dirname(paths.specsDir), paths.archiveFile),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `INFERNO state.yaml single-writer

  node state-transition.cjs claim-intent   --intent <id> [--run <run-id>]
  node state-transition.cjs unclaim-intent --intent <id>
  node state-transition.cjs complete-item --intent <id> --item <id>
  node state-transition.cjs close-intent  --intent <id>
  node state-transition.cjs archive-intent [--intent <id>] [--sweep]
  node state-transition.cjs check [--intent <id>]

Options
  --file <path>   state file (default ${DEFAULT_STATE_PATH})
  --run <run-id>  the run taking the intent, recorded as claimed_by (claim-intent)
  --now <iso>     override the timestamp (tests / backfill)
  --json          machine-readable output

claim-intent takes a pending intent for one run: status in_progress plus claimed_at and
claimed_by. It refuses an intent another run holds and one whose prerequisite intents are
not all completed or archived, so two sessions cannot build the same intent. Committing the
claim is the caller's job. unclaim-intent gives back a claim that never integrated.

archive-intent moves completed intents into archive/state.yaml and archive/intents/, frees
them from the remaining intents' depends_on_intents, and refuses anything not completed.
--sweep adds every other completed intent except one another session is still shipping.
close-intent refuses while any work item is still open; complete each item first.
check exits 1 when the ledger drifts from its work items, or when .specs-inferno/quick-fixes.md
exists beside it (nothing builds from a parking file; a one-item request is a one-item intent).`;

function parseArgs(argv) {
  const options = { file: DEFAULT_STATE_PATH };
  const command = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new TransitionError(`unexpected argument: ${arg}`, 'BAD_ARGS');
    // Boolean flags take no value; everything else is `--key value`.
    if (arg === '--json' || arg === '--sweep') {
      options[arg.slice(2)] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TransitionError(`missing value for ${arg}`, 'BAD_ARGS');
    }
    options[arg.slice(2).replace(/-/g, '_')] = value;
    i += 1;
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);

  if (!command || ['--help', '-h', 'help'].includes(command)) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === 'claim-intent') {
    if (!options.intent) throw new TransitionError('claim-intent requires --intent', 'BAD_ARGS');
    const result = claimIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `claimed ${result.intent} at ${result.claimed_at}${result.run ? ` for ${result.run}` : ''}\n`
      );
    } else process.stdout.write(`intent ${result.intent} ${result.note}\n`);
    return 0;
  }

  if (command === 'unclaim-intent') {
    if (!options.intent) throw new TransitionError('unclaim-intent requires --intent', 'BAD_ARGS');
    const result = unclaimIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(`unclaimed ${result.intent} (was ${result.previous}); it is pending again\n`);
    } else process.stdout.write(`intent ${result.intent} ${result.note}\n`);
    return 0;
  }

  if (command === 'complete-item') {
    if (!options.intent || !options.item) {
      throw new TransitionError('complete-item requires --intent and --item', 'BAD_ARGS');
    }
    const result = completeItem(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `completed ${result.item} (was ${result.previous || 'unset'}) at ${result.completed_at}` +
          `${result.markdown ? ` + synced ${result.markdown}` : ''}\n`
      );
    } else process.stdout.write(`${result.item} already completed — no change\n`);
    return 0;
  }

  if (command === 'close-intent') {
    if (!options.intent) throw new TransitionError('close-intent requires --intent', 'BAD_ARGS');
    const result = closeIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `closed intent ${result.intent} (was ${result.previous || 'unset'}) at ${result.completed_at}; ` +
          `${result.items} work items completed\n`
      );
    } else process.stdout.write(`intent ${result.intent} already completed — no change\n`);
    return 0;
  }

  if (command === 'archive-intent') {
    if (!options.intent && !options.sweep) {
      throw new TransitionError('archive-intent requires --intent <id> or --sweep', 'BAD_ARGS');
    }
    const result = archiveIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `archived ${result.archived.length} intent(s) to ${result.archive}: ${result.archived.join(', ')}\n`
      );
      for (const entry of result.freed) {
        process.stdout.write(`  freed ${entry.intent} from ${entry.freed.join(', ')}\n`);
      }
      for (const entry of result.directories.filter((d) => d.result !== 'moved')) {
        process.stdout.write(`  directory for ${entry.intent}: ${entry.result}\n`);
      }
      if (result.skipped.length > 0) {
        process.stdout.write(`  left alone (still shipping): ${result.skipped.join(', ')}\n`);
      }
    } else process.stdout.write(`${result.note} - no change\n`);
    return 0;
  }

  if (command === 'check') {
    const result = check(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.archived) {
      process.stdout.write(`intent ${result.archived} is archived; nothing left to check in the live ledger\n`);
    } else if (result.drift.length === 0) {
      process.stdout.write(`ledger consistent across ${result.intents} intent(s)\n`);
    } else {
      for (const entry of result.drift) process.stdout.write(`DRIFT ${entry.intent}: ${entry.detail}\n`);
    }
    return result.drift.length === 0 ? 0 : 1;
  }

  throw new TransitionError(`unknown command: ${command}`, 'BAD_ARGS');
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
