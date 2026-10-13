'use strict';

/**
 * The Rust side of `run.cjs mutate --batch`: where a mistake can sit behind a run-time switch,
 * the switch text, and which entries a failed build blames.
 *
 * A switch is off by default. It reads INFERNO_MUTANT once per site through a block-local
 * OnceLock (Rust 1.70 or later), so one build serves every entry:
 *
 *   expression form  (if <on k> { <replace> } else { <find> })
 *   statement form   if <on k> { <replace> } else { <find> }    for whole statements ending in `;`
 *   <on k>           { static INFERNO_SWITCH: ::std::sync::OnceLock<bool> = ::std::sync::OnceLock::new();
 *                      *INFERNO_SWITCH.get_or_init(|| ::std::env::var("INFERNO_MUTANT").map_or(false, |v| v == "k")) }
 *
 * The off branch must mean what the line meant, so a switch is written only where that holds.
 * `find` covers whole tokens of code, outside any string, comment or attribute. An expression
 * stands where a value stands and binds tighter than its neighbours. A statement starts a
 * statement and declares nothing. Anything else, and anything in a const or static item, takes
 * the classic in-place build. A switch the compiler still refuses (a pattern, a type, a const fn,
 * a crate that denies the warning on its parentheses) is blamed from the compiler's file:line
 * and takes the classic build too.
 */

const PUNCT = ['>>=', '<<=', '...', '..=', '::', '->', '=>', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '^=', '&=', '|=', '<<', '>>', '..'];
/** Binding strength of each infix operator, loosest first: assignment 2 up to multiplication 12. */
const BINARY = new Map([
  ['=', 2], ['+=', 2], ['-=', 2], ['*=', 2], ['/=', 2], ['%=', 2], ['^=', 2], ['&=', 2], ['|=', 2], ['<<=', 2], ['>>=', 2],
  ['..', 3], ['..=', 3], ['||', 4], ['&&', 5], ['==', 6], ['!=', 6], ['<', 6], ['>', 6], ['<=', 6], ['>=', 6],
  ['|', 7], ['^', 8], ['&', 9], ['<<', 10], ['>>', 10], ['+', 11], ['-', 11], ['*', 12], ['/', 12], ['%', 12],
]);
const JUMP = 1;
const AS = 13;
const UNARY = 14;
const POSTFIX = 15;
const ATOM = 16;
const LEFT_ASSOC = new Set([4, 5, 7, 8, 9, 10, 11, 12, AS]);
/** Infix after an operand, prefix (or a closure's bars) anywhere else. */
const AMBIGUOUS = new Set(['*', '-', '&', '&&', '|', '||']);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const DELIM_LEFT = new Set(['(', '[', '{', ',', ';', '=>', '}', ':', '->']);
const DELIM_RIGHT = new Set([')', ']', '}', ',', ';', '=>', '{', ':']);
const KEY_LEFT = new Set(['return', 'break', 'in', 'if', 'while', 'match', 'else', 'yield']);
const KEYWORDS = new Set([...KEY_LEFT, 'let', 'mut', 'ref', 'move', 'as', 'fn', 'pub', 'use', 'mod', 'where', 'for', 'loop',
  'unsafe', 'async', 'dyn', 'impl', 'struct', 'enum', 'trait', 'type', 'const', 'static', 'extern', 'continue']);
const DECLARES = new Set(['let', 'fn', 'struct', 'enum', 'use', 'mod', 'const', 'static', 'type', 'impl', 'trait', 'pub',
  'extern', 'macro_rules', 'union']);

const identStart = (c) => /[A-Za-z_]/.test(c) || c > '\x7f';
const identChar = (c) => /[A-Za-z0-9_]/.test(c) || c > '\x7f';

function quotedEnd(text, i) {
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === '\\') j += 1;
    else if (text[j] === '"') return j + 1;
  }
  return text.length;
}

/** The end of a raw string whose hashes start at `i`, or -1 when no quote follows them. */
function rawEnd(text, i) {
  let j = i;
  while (text[j] === '#') j += 1;
  if (text[j] !== '"') return -1;
  const close = `"${'#'.repeat(j - i)}`;
  const end = text.indexOf(close, j + 1);
  return end === -1 ? text.length : end + close.length;
}

/** The end of a char literal opening at `i`, or -1 for a lifetime or a label. */
function charEnd(text, i) {
  if (text[i + 1] === '\\') {
    const end = text.indexOf("'", i + 3);
    return end === -1 ? text.length : end + 1;
  }
  const width = (text.codePointAt(i + 1) || 0) > 0xffff ? 2 : 1;
  return text[i + 1 + width] === "'" ? i + 2 + width : -1;
}

function numberEnd(text, i) {
  const radix = text[i] === '0' && /[xob]/.test(text[i + 1] || '');
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (identChar(c)) j += 1;
    else if (c === '.' && !radix && /[0-9]/.test(text[j + 1] || '')) j += 1;
    else if ((c === '+' || c === '-') && !radix && /[eE]/.test(text[j - 1]) && /[0-9]/.test(text[j + 1] || '')) j += 1;
    else break;
  }
  return j;
}

/** The end of the word token at `i`: an identifier, a raw identifier, or a prefixed literal. */
function wordToken(text, i) {
  let j = i + 1;
  while (j < text.length && identChar(text[j])) j += 1;
  const word = text.slice(i, j);
  const next = text[j];
  if ((word === 'b' || word === 'c') && next === '"') return ['literal', quotedEnd(text, j)];
  if (word === 'b' && next === "'") return ['literal', Math.max(charEnd(text, j), j + 1)];
  if (['r', 'br', 'cr'].includes(word) && (next === '"' || next === '#')) {
    const end = rawEnd(text, j);
    if (end !== -1) return ['literal', end];
  }
  if (word === 'r' && next === '#' && identStart(text[j + 1] || '')) {
    let k = j + 2;
    while (k < text.length && identChar(text[k])) k += 1;
    return ['ident', k];
  }
  return ['ident', j];
}

/** The tokens of a Rust source, without whitespace and comments, and the spans of its line comments. */
function lex(text) {
  const tokens = [];
  const comments = [];
  let i = 0;
  const push = (kind, end) => {
    tokens.push({ kind, start: i, end, text: text.slice(i, end) });
    i = end;
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      comments.push([i, end === -1 ? text.length : end]);
      i = end === -1 ? text.length : end;
    } else if (text.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text.startsWith('/*', i)) depth += 1;
        else if (text.startsWith('*/', i)) depth -= 1;
        i += text.startsWith('/*', i) || text.startsWith('*/', i) ? 2 : 1;
      }
    } else if (c === '"') {
      push('literal', quotedEnd(text, i));
    } else if (c === "'") {
      const end = charEnd(text, i);
      let j = i + 1;
      while (j < text.length && identChar(text[j])) j += 1;
      if (end !== -1) push('literal', end);
      else push('lifetime', j);
    } else if (identStart(c)) {
      const [kind, end] = wordToken(text, i);
      push(kind, end);
    } else if (/[0-9]/.test(c)) {
      push('literal', numberEnd(text, i));
    } else {
      push('punct', i + (PUNCT.find((op) => text.startsWith(op, i)) || c).length);
    }
  }
  return { tokens, comments };
}

/** The source spans of `#[...]` and `#![...]`; an attribute that never closes runs to the end. */
function attributeSpans(tokens) {
  const spans = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].text !== '#') continue;
    let j = i + 1;
    if (tokens[j] && tokens[j].text === '!') j += 1;
    if (!tokens[j] || tokens[j].text !== '[') continue;
    let depth = 0;
    let k = j;
    for (; k < tokens.length; k += 1) {
      if (tokens[k].text === '[') depth += 1;
      if (tokens[k].text === ']') depth -= 1;
      if (depth === 0) break;
    }
    spans.push([tokens[i].start, k < tokens.length ? tokens[k].end : Infinity]);
  }
  return spans;
}

const endsOperand = (t) => Boolean(t) &&
  ((t.kind === 'ident' && !KEYWORDS.has(t.text)) || t.kind === 'literal' || [')', ']', '}', '?'].includes(t.text));

function balanced(span) {
  let depth = 0;
  for (const t of span) {
    if (OPEN.has(t.text)) depth += 1;
    if (CLOSE.has(t.text)) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** The index of the `>` closing the turbofish `<` at `i`. */
function genericEnd(span, i) {
  let depth = 0;
  for (let j = i; j < span.length; j += 1) {
    if (span[j].text === '<') depth += 1;
    if (span[j].text === '>') depth -= 1;
    if (span[j].text === '>>') depth -= 2;
    if (depth <= 0) return j;
  }
  return span.length - 1;
}

/** How loosely the span binds at its top level, ATOM when it holds no operator, or null when it is no one expression. */
function innerLevel(span) {
  let depth = 0;
  let level = ATOM;
  let after = false;
  for (let i = 0; i < span.length; i += 1) {
    const t = span[i];
    if (OPEN.has(t.text)) depth += 1;
    else if (CLOSE.has(t.text)) {
      depth -= 1;
      after = true;
    } else if (depth > 0) {
      continue;
    } else if (t.kind === 'ident' && t.text === 'as' && after) {
      level = Math.min(level, AS);
      after = false;
    } else if (t.kind === 'ident' && ['return', 'break', 'yield', 'move'].includes(t.text)) {
      level = JUMP;
      after = false;
    } else if (t.kind !== 'punct') {
      after = t.kind !== 'ident' || !KEYWORDS.has(t.text);
    } else if (t.text === '.' || (t.text === '!' && after)) {
      after = false;
    } else if (t.text === '?') {
      after = true;
    } else if (t.text === '::') {
      if (span[i + 1] && span[i + 1].text === '<') i = genericEnd(span, i + 1);
      after = span[i].text === '>' || span[i].text === '>>';
    } else if ((t.text === '|' || t.text === '||') && !after) {
      level = JUMP;
    } else if (BINARY.has(t.text) && (after || t.text === '..' || t.text === '..=')) {
      level = Math.min(level, BINARY.get(t.text));
      after = false;
    } else if (!after && ['!', '-', '*', '&', '&&'].includes(t.text)) {
      level = Math.min(level, UNARY);
    } else {
      return null;
    }
  }
  return depth === 0 ? level : null;
}

/** How tightly the token before the span binds to it: 0 for a delimiter, null where no value stands. */
function leftLevel(tokens, first) {
  const p = tokens[first - 1];
  if (!p) return 0;
  if (p.kind === 'ident') return KEY_LEFT.has(p.text) ? 0 : null;
  if (p.kind !== 'punct') return null;
  if (DELIM_LEFT.has(p.text)) return 0;
  if (AMBIGUOUS.has(p.text)) {
    if (endsOperand(tokens[first - 2])) return BINARY.get(p.text);
    if (p.text === '|' || p.text === '||') return 0;
    // A reference would borrow the switch's temporary instead of the place the line named.
    return p.text === '-' || p.text === '*' ? UNARY : null;
  }
  if (p.text === '!') return UNARY;
  return BINARY.has(p.text) ? BINARY.get(p.text) : null;
}

/** How tightly the token after the span binds to it: null for a place, a call or a path. */
function rightLevel(tokens, last) {
  const n = tokens[last + 1];
  if (!n) return 0;
  if (n.kind === 'ident') return n.text === 'as' ? AS : n.text === 'else' ? 0 : null;
  if (n.kind !== 'punct') return null;
  if (DELIM_RIGHT.has(n.text)) return 0;
  if (BINARY.get(n.text) === 2) return null;
  if (BINARY.has(n.text)) return BINARY.get(n.text);
  return n.text === '?' ? POSTFIX : null;
}

function fits(tokens, first, last, inner) {
  const left = leftLevel(tokens, first);
  const right = rightLevel(tokens, last);
  if (left === null || right === null) return false;
  const leftOk = inner > left || (inner === 2 && left === 2);
  const rightOk = right === POSTFIX ? inner === ATOM : inner > right || (inner === right && LEFT_ASSOC.has(inner));
  return leftOk && rightOk;
}

/** Whether the token at `first` sits in a const or static item, read back to the statement's start. */
function inConstItem(tokens, first) {
  let depth = 0;
  let i = first - 1;
  for (; i >= 0; i -= 1) {
    const t = tokens[i].text;
    if (t === ')' || t === ']') depth += 1;
    else if ((t === '(' || t === '[') && depth > 0) depth -= 1;
    else if (depth === 0 && (t === ';' || t === '{' || t === '}')) break;
  }
  let j = i + 1;
  while (tokens[j] && tokens[j].text === '#') {
    while (tokens[j] && tokens[j].text !== ']') j += 1;
    j += 1;
  }
  if (tokens[j] && tokens[j].text === 'pub') {
    j += 1;
    if (tokens[j] && tokens[j].text === '(') {
      while (tokens[j] && tokens[j].text !== ')') j += 1;
      j += 1;
    }
  }
  const word = tokens[j] && tokens[j].text;
  const next = tokens[j + 1] && tokens[j + 1].text;
  return word === 'static' || (word === 'const' && !['fn', 'unsafe', 'async', 'extern', '{'].includes(next));
}

function declares(span) {
  let depth = 0;
  for (const t of span) {
    if (OPEN.has(t.text)) depth += 1;
    if (CLOSE.has(t.text)) depth -= 1;
    if (depth === 0 && t.kind === 'ident' && DECLARES.has(t.text)) return true;
  }
  return false;
}

const on = (k) => '{ static INFERNO_SWITCH: ::std::sync::OnceLock<bool> = ::std::sync::OnceLock::new(); ' +
  `*INFERNO_SWITCH.get_or_init(|| ::std::env::var("INFERNO_MUTANT").map_or(false, |v| v == "${k}")) }`;

function switchText(k, find, replace, variant) {
  const body = `if ${on(k)} { ${replace} } else { ${find} }`;
  return variant === 'statement' ? body : `(${body})`;
}

const lineStarts = (text) => [0, ...[...text.matchAll(/\n/g)].map((match) => match.index + 1)];

function planOne(text, lexed, starts, entry) {
  const { tokens, comments, attributes, byStart, byEnd } = lexed;
  const base = starts[entry.n - 1];
  const lineText = text.slice(base, (starts[entry.n] || text.length + 1) - 1);
  const find = entry.find.trim();
  const start = base + entry.col + (entry.find.length - entry.find.trimStart().length);
  const end = start + find.length;
  const classic = (why) => ({ form: 'classic', why });
  if (/^\s*#!?\[/.test(lineText)) return classic('on an attribute line');
  if (attributes.some(([s, e]) => start < e && s < end)) return classic('inside an attribute');
  if (comments.some(([s, e]) => start < e && s < end)) return classic('find holds a line comment');
  const first = byStart.get(start);
  const last = byEnd.get(end);
  if (first === undefined || last === undefined || last < first) return classic('find does not cover whole tokens of code');
  const span = tokens.slice(first, last + 1);
  if (span.every((t) => t.kind === 'punct')) return classic('find is an operator, not an expression');
  if (!balanced(span)) return classic('find opens or closes a bracket it does not hold');
  if (inConstItem(tokens, first)) return classic('in a const or static item');
  const plan = (variant) => ({ form: 'switch', variant, start, end, text: switchText(entry.k, find, entry.replace.trim(), variant) });
  if (find.endsWith(';')) {
    const before = tokens[first - 1];
    if (before && !['{', ';', '}'].includes(before.text)) return classic('find ends in ; but does not start a statement');
    return declares(span) ? classic('a let or an item cannot sit inside a switch') : plan('statement');
  }
  const inner = innerLevel(span);
  if (inner === null) return classic('find is not one expression');
  return fits(tokens, first, last, inner) ? plan('expression') : classic('a switch here could change how the line parses');
}

/**
 * The plan of each entry ({k, n, col, find, replace}) of one file's `text`: a switch with its
 * source span and text, or the classic build with the reason. Two switches never overlap.
 */
function planRust(text, entries) {
  const { tokens, comments } = lex(text);
  const lexed = {
    tokens, comments, attributes: attributeSpans(tokens),
    byStart: new Map(tokens.map((t, i) => [t.start, i])), byEnd: new Map(tokens.map((t, i) => [t.end, i])),
  };
  const starts = lineStarts(text);
  const taken = [];
  return entries.map((entry) => {
    const plan = planOne(text, lexed, starts, entry);
    if (plan.form !== 'switch') return plan;
    const clash = taken.find((other) => plan.start < other.end && other.start < plan.end);
    if (clash) return { form: 'classic', why: `overlaps entry ${clash.k}` };
    taken.push({ start: plan.start, end: plan.end, k: entry.k });
    return plan;
  });
}

/** The new text of every line the switches ({start, end, text}) touch in `text`, by line number. */
function applySwitches(text, switches) {
  const starts = lineStarts(text);
  const lines = new Map();
  for (const item of [...switches].sort((a, b) => b.start - a.start)) {
    let n = starts.length;
    while (starts[n - 1] > item.start) n -= 1;
    const base = starts[n - 1];
    const line = lines.has(n) ? lines.get(n) : text.slice(base, (starts[n] || text.length + 1) - 1);
    lines.set(n, line.slice(0, item.start - base) + item.text + line.slice(item.end - base));
  }
  return lines;
}

/** Each error the compiler printed, with every file:line it names, primary or secondary. */
function errorBlocks(text) {
  const blocks = [];
  let block = null;
  let file = null;
  for (const line of String(text).replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const short = /^(\S+?):(\d+):\d+: error(?:\[E\d+\])?:/.exec(line);
    if (short) {
      blocks.push([{ file: short[1], line: Number(short[2]) }]);
      block = null;
    } else if (/^error(?:\[E\d+\])?: /.test(line)) {
      block = /^error: (?:could not compile|aborting due to|test failed|build failed)/.test(line) ? null : [];
      if (block) blocks.push(block);
      file = null;
    } else if (/^warning(?:\[.*?\])?: /.test(line)) {
      block = null;
    } else if (block) {
      const at = /^\s*(?:-->|:::)\s+(.+?):(\d+):\d+\s*$/.exec(line);
      const gutter = /^\s*(\d+)\s+\|/.exec(line);
      if (at) file = at[1];
      if (at || (gutter && file)) block.push({ file, line: Number(at ? at[2] : gutter[1]) });
    }
  }
  return blocks;
}

const sameFile = (rel, file) => {
  const named = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return rel === named || rel.endsWith(`/${named}`) || named.endsWith(`/${rel}`);
};

/**
 * The switched entries ({k, rel, n}) a failed build blames. An error on an entry's line blames
 * that entry. When no error does, an error blames every switch in the files it names, and an error
 * in no switched file blames every switch, so each failed build moves at least one entry.
 */
function blame(text, switched) {
  const errors = errorBlocks(text).flat();
  const onLine = switched.filter((e) => errors.some((at) => at.line === e.n && sameFile(e.rel, at.file)));
  if (onLine.length > 0) return onLine.map((e) => e.k);
  const inFile = switched.filter((e) => errors.some((at) => sameFile(e.rel, at.file)));
  return (inFile.length > 0 ? inFile : switched).map((e) => e.k);
}

module.exports = { applySwitches, blame, planRust, switchText };
