'use strict';

/** Identifier sequences in the ledger, with source locations for surgical edits. */
const {
  TransitionError, findKeyLine, indentOf, isSkippable, stripInlineComment,
} = require('./state-ledger.cjs');

function readList(lines, entry, key) {
  const index = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  const fail = () => {
    throw new TransitionError(
      `entry ${entry.id} has an invalid ${key} sequence near line ${index + 1}`,
      key === 'tester_cases' ? 'LIST_FORM' : 'DEPENDS_FORM'
    );
  };
  if (index === -1) return { index, form: 'absent', members: [] };
  const scalar = (source) => {
    const value = source.trim();
    let decoded;
    if (/^'(?:[^']|'')*'$/.test(value)) decoded = value.slice(1, -1).replace(/''/g, "'");
    else if (value.startsWith('"')) {
      try { decoded = JSON.parse(value); } catch { fail(); }
    } else if (/^[a-zA-Z0-9_./-]+$/.test(value)) decoded = value;
    else fail();
    if (typeof decoded !== 'string' || !decoded.length) fail();
    return decoded;
  };
  const raw = stripInlineComment(lines[index].slice(entry.keyIndent + key.length + 1)).trim();
  const members = [];
  const form = raw ? 'inline' : 'block';
  if (raw) {
    if (!raw.startsWith('[') || !raw.endsWith(']')) fail();
    const body = raw.slice(1, -1);
    let quote = null;
    let from = 0;
    for (let i = 0; i <= body.length; i++) {
      const char = body[i];
      if (quote) {
        if (quote === '"' && char === '\\') i++;
        else if (quote === "'" && char === "'" && body[i + 1] === "'") i++;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ',' || i === body.length) {
        const token = body.slice(from, i).trim();
        // YAML allows one trailing comma in a flow sequence.
        if (token) members.push({ value: scalar(token), source: token, line: index });
        else if (i !== body.length) fail();
        from = i + 1;
      }
    }
    if (quote) fail();
  }
  let memberIndent = null;
  for (let i = index + 1; i < entry.end; i++) {
    if (isSkippable(lines[i])) continue;
    const indent = indentOf(lines[i]);
    const sequenceLine = /^ *-\s+/.test(lines[i]);
    if (indent < entry.keyIndent || (indent === entry.keyIndent && !sequenceLine)) break;
    if (form !== 'block' || !sequenceLine) fail();
    if (memberIndent === null) memberIndent = indent;
    if (indent !== memberIndent) fail();
    const source = stripInlineComment(lines[i].slice(indent + 1)).trim();
    members.push({ value: scalar(source), source, line: i });
  }
  if (form === 'block' && !members.length) fail();
  return { index, form, members };
}

function listValues(lines, entry, key) {
  return readList(lines, entry, key).members.map(member => member.value);
}

/** Keep the original form and comments. An exhausted block becomes an explicit []. */
function removeListValues(lines, entry, key, ids) {
  const list = readList(lines, entry, key);
  const removed = list.members.filter(member => ids.has(member.value));
  if (!removed.length) return [];
  const remaining = list.members.filter(member => !ids.has(member.value));
  const header = lines[list.index];
  const commentAt = stripInlineComment(header).length;
  const comment = header.slice(commentAt);
  if (list.form === 'inline' || !remaining.length) {
    lines[list.index] = `${' '.repeat(entry.keyIndent)}${key}: [${remaining.map(m => m.source).join(', ')}]` +
      (comment ? ` ${comment}` : '');
  }
  if (list.form === 'block') {
    for (const member of [...removed].reverse()) {
      const source = lines[member.line];
      const comment = source.slice(stripInlineComment(source).length);
      if (comment) lines[member.line] = `${' '.repeat(indentOf(source))}${comment}`;
      else lines.splice(member.line, 1);
    }
  }
  return removed.map(member => member.value);
}

module.exports = { readList, listValues, removeListValues };
