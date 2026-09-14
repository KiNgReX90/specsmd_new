'use strict';

/**
 * A YAML subset: maps, block and inline lists, quoted scalars, block scalars. Enough for
 * .specs-inferno/config.yaml and a work item's execution manifest, and no more. Anything
 * richer belongs in a real parser.
 *
 * Zero dependencies, the constraint run-lib.cjs carries too: these scripts run inside
 * consumer projects that have no node_modules.
 */

const { RunError } = require('./run-error.cjs');

/** The escapes a double-quoted scalar carries. Anything else is a defect in the manifest. */
const ESCAPES = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ["'", "'"],
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['0', '\0'],
  [' ', ' '],
]);

/**
 * Where the quoted run opening at `start` closes, or -1 when it never does. A backslash
 * escape inside double quotes and a doubled quote inside single quotes stay inside the run,
 * which is what keeps a `#` or a `,` behind them out of the comment and list scanners.
 */
function endOfQuoted(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (quote === '"' && text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] !== quote) continue;
    if (quote === "'" && text[i + 1] === "'") {
      i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

function stripComment(value) {
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '"' || char === "'") {
      const end = endOfQuoted(value, i);
      if (end === -1) return value;
      i = end;
    } else if (char === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}

/**
 * Decode the body of a double-quoted scalar. An escape this parser does not implement
 * stops the run: passing it through hands bash a backslash its author never wrote, and a
 * finalize_check that reads a literal quote is red forever or green for nothing.
 */
function unescapeDouble(body, label) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next === undefined || !ESCAPES.has(next)) {
      throw new RunError(
        `unsupported escape \\${next === undefined ? '' : next} in the double-quoted value of ${label}. ` +
          `This parser reads \\" \\\\ \\/ \\' \\n \\t \\r \\0 and an escaped space.`,
        'BAD_MANIFEST'
      );
    }
    out += ESCAPES.get(next);
    i += 1;
  }
  return out;
}

/** Strip a scalar's outer quotes and decode what they escape. */
function unquote(value, label) {
  const trimmed = value.trim();
  const last = trimmed.length - 1;
  if (last >= 1 && (trimmed[0] === '"' || trimmed[0] === "'") && endOfQuoted(trimmed, 0) === last) {
    const body = trimmed.slice(1, -1);
    return trimmed[0] === '"' ? unescapeDouble(body, label || 'a value') : body.replace(/''/g, "'");
  }
  return trimmed;
}

/** Outer quotes only, for git's own quoting, whose C escapes this parser does not read. */
function stripQuotes(value) {
  const trimmed = value.trim();
  const last = trimmed.length - 1;
  if (last >= 1 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed[last] === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split an inline list on the commas outside its quoted entries. */
function splitInline(body) {
  const out = [];
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"' || char === "'") {
      const end = endOfQuoted(body, i);
      if (end === -1) break;
      i = end;
    } else if (char === ',') {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

function scalar(raw, label) {
  const text = stripComment(raw).trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitInline(text.slice(1, -1))
      .map((entry) => unquote(entry, label))
      .filter((entry) => entry.length > 0);
  }
  return unquote(text, label);
}

function rowsOf(text) {
  return text
    .split('\n')
    .map((line, index) => ({ indent: /^( *)/.exec(line)[1].length, text: line.trim(), raw: line, line: index + 1 }))
    .filter((row) => row.text.length > 0 && !row.text.startsWith('#'));
}

function parseBlockScalar(rows, index, indent) {
  const body = [];
  let i = index;
  while (i < rows.length && rows[i].indent > indent) {
    body.push(rows[i].text);
    i += 1;
  }
  return [body.join('\n'), i];
}

function parseNode(rows, index, indent, label) {
  if (rows[index].text.startsWith('- ')) return parseList(rows, index, indent, label);
  return parseMap(rows, index, indent);
}

function parseList(rows, index, indent, label) {
  const out = [];
  let i = index;
  while (i < rows.length && rows[i].indent === indent && rows[i].text.startsWith('- ')) {
    const rest = rows[i].text.slice(2);
    if (/^(?:"[^"]*"|'[^']*'|[^:]+):(?: |$)/.test(rest)) {
      rows[i] = { indent: indent + 2, text: rest, raw: rest, line: rows[i].line };
      const [value, next] = parseMap(rows, i, indent + 2);
      out.push(value);
      i = next;
    } else {
      out.push(scalar(rest, label));
      i += 1;
    }
  }
  return [out, i];
}

function parseMap(rows, index, indent) {
  const out = {};
  let i = index;
  while (i < rows.length && rows[i].indent === indent && !rows[i].text.startsWith('- ')) {
    const match = /^("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/.exec(rows[i].text);
    if (!match) break;
    const key = unquote(match[1], match[1]);
    const rest = match[2];
    // A header written `verification: # the cheap checks` carries a comment, not a value. Read
    // it as the empty value it is, or the block under it and every key after it fall out of
    // the document with no error at all (2026-09-09).
    const marker = rest.trim();
    const value = stripComment(rest).trim();
    i += 1;
    if (marker === '|' || marker === '>' || marker === '|-') {
      const [body, next] = parseBlockScalar(rows, i, indent);
      out[key] = body;
      i = next;
    } else if (value === '' && i < rows.length && rows[i].indent > indent) {
      const [value, next] = parseNode(rows, i, rows[i].indent, key);
      out[key] = value;
      i = next;
    } else {
      out[key] = scalar(rest, key);
    }
  }
  return [out, i];
}

/**
 * Parse the YAML subset above. Anything richer belongs in a real parser, not here.
 *
 * A document is parsed whole or not at all. Returning what was read up to the first line this
 * subset cannot place is how a config lost half its checks in silence, and half a config
 * looks exactly like a project that configured less.
 */
function parseYaml(text) {
  const rows = rowsOf(text);
  if (rows.length === 0) return {};
  const [value, next] = parseNode(rows, 0, rows[0].indent);
  if (next < rows.length) {
    throw new RunError(
      `cannot parse line ${rows[next].line}: ${rows[next].text}. This YAML subset reads maps, ` +
        'block and inline lists, quoted scalars and block scalars; nothing was read past that line.',
      'BAD_YAML'
    );
  }
  return value;
}

module.exports = { parseYaml, stripQuotes };
