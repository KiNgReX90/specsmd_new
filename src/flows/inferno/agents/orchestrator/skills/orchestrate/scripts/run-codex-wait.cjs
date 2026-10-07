'use strict';

/**
 * The wait floor of a Codex host. A Codex orchestrator waits on its builders with wait_agent,
 * and a timeout it picks itself wakes it every minute while a builder runs. Codex config holds
 * a floor no prompt can lower: the minimum of the multi_agent_v2 feature table. The frontier
 * refuses a Codex host until that floor is in place, so no dispatch starts on a host that
 * wakes early.
 *
 * A leaf that loads no other script. It reads that one table line by line, so the check needs
 * no TOML dependency. Codex lays the project config over the user config, so a key the
 * primary checkout's .codex/config.toml sets wins over the one in $CODEX_HOME/config.toml.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLOOR = 1200000;
const TABLE = 'features.multi_agent_v2';
const KEY = 'min_wait_timeout_ms';
const FRAGMENT = [`[${TABLE}]`, 'enabled = true', `${KEY} = ${FLOOR}`, `default_wait_timeout_ms = ${FLOOR}`];

const bare = (line) => line.replace(/#.*$/, '').trim();

/** The minimum the table sets in `text`, or null when the table or the key is not there. */
function tableMinimum(text) {
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = bare(raw);
    if (line.startsWith('[')) {
      inside = line.replace(/\s+/g, '') === `[${TABLE}]`;
      continue;
    }
    const match = inside && line.match(new RegExp(`^${KEY}\\s*=\\s*([0-9_]+)$`));
    if (match) return Number(match[1].replace(/_/g, ''));
  }
  return null;
}

/** The two files Codex reads, the project's first because its keys win. */
function configFiles(primary, env) {
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [path.join(primary, '.codex', 'config.toml'), path.join(home, 'config.toml')];
}

/** Null when the floor holds, else the refusal with its fix. */
function waitFloorRefusal(primary, env = process.env) {
  const files = configFiles(primary, env);
  for (const file of files) {
    const value = fs.existsSync(file) ? tableMinimum(fs.readFileSync(file, 'utf8')) : null;
    if (value === null) continue;
    if (value >= FLOOR) return null;
    return `${file} sets ${KEY} = ${value} under [${TABLE}], so wait_agent wakes the orchestrator before a builder ` +
      `can return: set ${KEY} and default_wait_timeout_ms to ${FLOOR} there.`;
  }
  return `a Codex host needs a wait floor, so wait_agent never wakes the orchestrator before ${FLOOR} ms: ` +
    `add these lines to ${files[0]}:\n${FRAGMENT.join('\n')}`;
}

module.exports = { FLOOR, FRAGMENT, tableMinimum, waitFloorRefusal };
