'use strict';

/**
 * The text shapes the case gate reads, as pure functions: the case blocks of a case file, the
 * test blocks of a test file, the `Cases:` lines of a commit message, and whether a case names a
 * label. run-cases.cjs owns the config, git and the three rules.
 */

/** A markdown heading, and its level. */
const HEADING = /^(#{1,6})\s/;

/**
 * Each case of one case file: the id group 1 of `opener` captures, and its lines, from its opener
 * to the line before the next opener or the next heading no deeper than the opener's own.
 */
function caseBlocks(text, opener) {
  const lines = text.split('\n');
  const blocks = [];
  let open = null;
  const close = (end) => {
    if (open) blocks.push({ ...open, end, text: lines.slice(open.start - 1, end).join('\n') });
    open = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const match = opener.exec(lines[i]);
    const heading = HEADING.exec(lines[i]);
    if (match && match[1]) {
      close(i);
      open = { id: match[1], start: i + 1, level: heading ? heading[1].length : 6 };
    } else if (open && heading && heading[1].length <= open.level) close(i);
  }
  close(lines.length);
  return blocks;
}

const JS_TEST = /^(\s*)(?:test|it)(?:\.(?:only|skip|fixme|fail|serial|concurrent|todo))*\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/;
const RUST_ATTR = /^(\s*)#\[(?:\w+::)*test\b/;
const RUST_FN = /^(\s*)(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/;
/** How far below its `#[test]` attribute a Rust test may name its function. */
const RUST_REACH = 4;

/** The line that closes a block opened at `indent`: the same indent, then `}` or `)`. */
function closer(lines, from, indent) {
  for (let i = from; i < lines.length; i += 1) {
    const own = /^(\s*)/.exec(lines[i])[1];
    if (own === indent && /^[})]/.test(lines[i].slice(own.length))) return i;
  }
  return lines.length - 1;
}

/**
 * Each `test(` or `it(` block of a JS test, and each `#[test]` function of a Rust one, with its
 * title and its lines, first and last numbered from one.
 */
function testBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const js = JS_TEST.exec(lines[i]);
    if (js) {
      const end = closer(lines, i + 1, js[1]);
      blocks.push({ title: js[3], start: i + 1, end: end + 1 });
      continue;
    }
    if (!RUST_ATTR.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + RUST_REACH); j += 1) {
      const fn = RUST_FN.exec(lines[j]);
      if (!fn) continue;
      const end = closer(lines, j + 1, fn[1]);
      blocks.push({ title: fn[2], start: i + 1, end: end + 1 });
      i = end;
      break;
    }
  }
  return blocks;
}

/** The innermost block holding line `line`, or null at module level. */
function blockAt(blocks, line) {
  let found = null;
  for (const block of blocks) {
    if (block.start <= line && line <= block.end && (!found || block.start >= found.start)) found = block;
  }
  return found;
}

/** The ids and the `none` the `Cases:` lines of some commit messages name. */
function trailers(messages) {
  const ids = new Set();
  let none = false;
  let any = false;
  for (const message of messages) {
    for (const match of message.matchAll(/^Cases:[ \t]*(.*)$/gm)) {
      any = true;
      for (const token of match[1].split(/[,\s]+/).filter(Boolean)) {
        if (token.toLowerCase() === 'none') none = true;
        else ids.add(token);
      }
    }
  }
  return { any, none, ids };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How case prose names a label of two or more words, in any case and wrapped over lines or not,
 * or null for one word: "Watch" or "Register" names a screen, a tab and a button at once.
 */
function labelPattern(label) {
  const words = label.trim().split(/\s+/);
  return words.length >= 2 ? new RegExp(`(?<![\\w-])${words.map(escape).join('\\s+')}(?![\\w-])`, 'i') : null;
}

/** Whether `text` names case id `id` whole, so TC-10 never matches TC-101. */
function namesId(text, id) {
  return text.includes(id) && new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`).test(text);
}

module.exports = { blockAt, caseBlocks, labelPattern, namesId, testBlocks, trailers };
