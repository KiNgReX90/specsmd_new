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
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

// `done` is not our vocabulary, but existing projects seeded their ledger with it.
// Accept it as terminal on read so this script is usable there; always WRITE `completed`.
const COMPLETE_VALUES = new Set(['completed', 'done']);

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

/**
 * Detect ledger drift. This is the check that never existed: a run could finish, merge and
 * push while state.yaml still read `pending`, and nothing anywhere would notice.
 */
function check(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const lines = loadState(file);
  const entries = locateIntents(lines);
  const scope = options.intent ? entries.filter((entry) => entry.id === options.intent) : entries;
  if (options.intent && scope.length === 0) getIntent(lines, options.intent);

  const drift = [];
  for (const intent of scope) {
    const intentStatus = statusOf(lines, intent);
    const items = locateWorkItems(lines, intent).map((item) => ({ id: item.id, status: statusOf(lines, item) }));
    if (items.length === 0) continue;

    const open = items.filter((item) => !isComplete(item.status));

    if (isComplete(intentStatus) && open.length > 0) {
      drift.push({
        intent: intent.id,
        kind: 'intent-completed-over-open-items',
        detail: `intent is ${intentStatus} but ${open.length}/${items.length} work items are not: ` +
          open.map((item) => item.id).join(', '),
      });
    }

    if (!isComplete(intentStatus) && open.length === 0) {
      drift.push({
        intent: intent.id,
        kind: 'all-items-completed-intent-open',
        detail: `all ${items.length} work items are completed but the intent is ${intentStatus || 'unset'}. ` +
          `Close it with: close-intent --intent ${intent.id}`,
      });
    }
  }
  return { drift, intents: scope.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `INFERNO state.yaml single-writer

  node state-transition.cjs complete-item --intent <id> --item <id>
  node state-transition.cjs close-intent  --intent <id>
  node state-transition.cjs check [--intent <id>]

Options
  --file <path>   state file (default ${DEFAULT_STATE_PATH})
  --now <iso>     override the timestamp (tests / backfill)
  --json          machine-readable output

close-intent refuses while any work item is still open; complete each item first.
check exits 1 when the ledger drifts from its work items.`;

function parseArgs(argv) {
  const options = { file: DEFAULT_STATE_PATH };
  const command = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new TransitionError(`unexpected argument: ${arg}`, 'BAD_ARGS');
    if (arg === '--json') {
      options.json = true;
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

  if (command === 'check') {
    const result = check(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.drift.length === 0) {
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

module.exports = { completeItem, closeIntent, check, TransitionError, main };
