'use strict';

// Shared line access and mutations for the ledger. No package dependencies.
const fs = require('fs');

// `done` is not our vocabulary, but existing projects seeded their ledger with it.
// Accept it as terminal on read so this script is usable there; always WRITE `completed`.
const COMPLETE_VALUES = new Set(['completed', 'done']);

// Statuses are three-way, not two-way. A ledger in the wild also carries deliberately
// PARKED entries. `superseded` (replaced by another approach), `on_hold`, `blocked`,
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
    if (inDouble && char === '\\') { i += 1; continue; }
    if (inSingle && char === "'" && value[i + 1] === "'") { i += 1; continue; }
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
 * indent. so comment blocks stay attached to the entry above them.
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

/** Active, unfinished work. the only thing `check` may call drift. */
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

module.exports = {
  TransitionError, PARKED_VALUES, indentOf, isSkippable, stripInlineComment, unquote, findKeyLine,
  loadState, locateIntents, locateWorkItems, getIntent, statusOf, isComplete, isOpen,
  setField, removeField, nowIso, writeState,
};
