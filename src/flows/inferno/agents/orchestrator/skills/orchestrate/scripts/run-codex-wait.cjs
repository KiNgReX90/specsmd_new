'use strict';

/**
 * The wait floor of a Codex host. A Codex orchestrator waits on its builders with wait_agent,
 * and a timeout it picks itself wakes it every minute while a builder runs. Codex config holds
 * a floor no prompt can lower: the minimum of the multi_agent_v2 feature table. The frontier
 * refuses a Codex host until that floor is in place, so no dispatch starts on a host that
 * wakes early.
 *
 * A leaf that loads no other script. It reads the table line by line, with no TOML dependency,
 * in every spelling codex-cli 0.159 reads it: a table header, quoted or not, dotted keys at the
 * top level or under [features], an inline table, or a bare switch. A multi-line string is
 * skipped, and the floor counts only while the table is enabled, because Codex applies it only
 * then. The default counts too: Codex refuses to load a default below the minimum. Codex lays the project config over the user config key by key, so a key the primary
 * checkout's .codex/config.toml sets wins over the one in $CODEX_HOME/config.toml.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLOOR = 1200000;
const TABLE = 'features.multi_agent_v2';
const WANTED = { enabled: true, min_wait_timeout_ms: FLOOR, default_wait_timeout_ms: FLOOR };
const FRAGMENT = [`[${TABLE}]`, ...Object.entries(WANTED).map(([key, value]) => `${key} = ${value}`)];

/** A dotted key or header as its bare segments: spaces around dots and quotes dropped. */
const segments = (text) => text.split('.').map((part) => part.trim().replace(/^(["'])(.*)\1$/, '$2'));
const bare = (line) => line.replace(/#.*$/, '').trim();

function value(text) {
  if (text === 'true' || text === 'false') return text === 'true';
  return /^[0-9_]+$/.test(text) ? Number(text.replace(/_/g, '')) : text;
}

/** The pairs of an inline table, whose values here are never strings holding a comma. */
function inlinePairs(text) {
  const pairs = {};
  for (const part of text.replace(/^\{|\}$/g, '').split(',')) {
    const at = part.indexOf('=');
    if (at > 0) pairs[segments(part.slice(0, at)).join('.')] = value(part.slice(at + 1).trim());
  }
  return pairs;
}

/**
 * What one file says about the table: the keys it sets, the spelling it defines the table in
 * (`table`, `features`, `top`, `inline` or `switch`, null when it never names it), and whether
 * it sets features as an inline table, which Codex reads but this leaf does not look into.
 */
function readTable(text) {
  const keys = {};
  let form = null;
  let inlineFeatures = false;
  let table = [];
  let open = null;
  for (const raw of text.split(/\r?\n/)) {
    const quote = open || ['"""', "'''"].find((mark) => raw.includes(mark));
    if (quote && raw.split(quote).length % 2 === 0) open = open ? null : quote;
    if (quote) continue;
    const line = bare(raw);
    if (line.startsWith('[')) {
      table = line.startsWith('[[') ? [null] : segments(line.replace(/^\[|\]$/g, ''));
      if (table.join('.') === TABLE) form = form || 'table';
      continue;
    }
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const name = [...table, ...segments(line.slice(0, at))].join('.');
    const right = line.slice(at + 1).trim();
    if (name === 'features' && right.startsWith('{')) inlineFeatures = true;
    if (name === TABLE) {
      form = form || (right.startsWith('{') ? 'inline' : 'switch');
      if (right.startsWith('{')) Object.assign(keys, inlinePairs(right));
      else keys.enabled = value(right);
    } else if (name.startsWith(`${TABLE}.`)) {
      form = form || (table.length === 0 ? 'top' : 'features');
      keys[name.slice(TABLE.length + 1)] = value(right);
    }
  }
  return { form, inlineFeatures, keys };
}

/** The two files Codex reads, the project's first because its keys win. */
function configFiles(primary, env) {
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [path.join(primary, '.codex', 'config.toml'), path.join(home, 'config.toml')];
}

/**
 * Null when the floor holds, else the one refusal. It names the file that defines the table, or
 * the project's when none does, and asks for the canonical table in place of every other
 * spelling, so applied as written the file holds one definition Codex reads.
 */
function waitFloorRefusal(primary, env = process.env) {
  const files = configFiles(primary, env).map((file) => ({ file, ...readTable(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') }));
  const merged = Object.assign({}, ...files.slice().reverse().map((entry) => entry.keys));
  const holds = Object.entries(WANTED).every(([key, want]) => (key === 'enabled' ? merged[key] === true : merged[key] >= want));
  if (holds) return null;
  const target = files.find((entry) => entry.form) || files[0];
  // A [features.multi_agent_v2] table cannot extend an inline features table, so that one moves first.
  const inline = target.inlineFeatures
    ? ' It sets features = { } inline, so first move the keys that stay in it under a [features] table at the end of the file.'
    : '';
  return `${target.file} holds no wait floor Codex applies, so wait_agent can wake the orchestrator before a builder ` +
    `returns.${inline} Remove every other multi_agent_v2 setting in that file, a table, a dotted key or an inline ` +
    `table, and append this table at its end:\n${FRAGMENT.join('\n')}`;
}

module.exports = { FLOOR, FRAGMENT, readTable, waitFloorRefusal };
