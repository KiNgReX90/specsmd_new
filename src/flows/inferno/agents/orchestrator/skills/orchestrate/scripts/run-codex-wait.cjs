'use strict';

/**
 * The wait floor of a Codex host. A Codex orchestrator waits on its builders with wait_agent,
 * and a timeout it picks itself wakes it every minute while a builder runs. Codex config holds
 * a floor no prompt can lower: the minimum of the multi_agent_v2 feature table. The frontier
 * refuses a Codex host until that floor is in place, so no dispatch starts on a host that
 * wakes early.
 *
 * Codex is the only reader. Every line reader of its config disagreed with it somewhere: a
 * spelling, a multi-line string, a layer it could not see, a project Codex does not trust. So
 * the check asks codex itself, twice. `features list` loading with multi_agent_v2 true proves
 * the table is on and its default is at least its minimum. The same call with the default
 * pinned one below the floor failing on the minimum proves the minimum is at least the floor.
 * A fix is printed only after Codex judged it, on the project config alone in a scratch home.
 *
 * A leaf that loads no other script.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FLOOR = 1200000;
const FRAGMENT = ['[features.multi_agent_v2]', 'enabled = true', `min_wait_timeout_ms = ${FLOOR}`, `default_wait_timeout_ms = ${FLOOR}`];
const BELOW = `features.multi_agent_v2.default_wait_timeout_ms=${FLOOR - 1}`;
const MINIMUM = 'default_wait_timeout_ms must be at least features.multi_agent_v2.min_wait_timeout_ms';
const ROW = /^multi_agent_v2\s.*\btrue\s*$/m;

function features(cmd, cwd, env, extra = []) {
  const result = spawnSync(cmd, ['features', 'list', ...extra], { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
  const missing = Boolean(result.error) && result.error.code === 'ENOENT';
  return { missing, ok: result.status === 0 && !result.error, out: `${result.stdout || ''}${result.stderr || ''}` };
}

/** Codex's first "Caused by" line, without its index and its path:line:col. */
function cause(out) {
  const lines = out.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === 'Caused by:');
  const first = at < 0 ? '' : lines.slice(at + 1).find((line) => line.trim().length > 0) || '';
  return first.trim().replace(/^\d+:\s*/, '').replace(/^.*?:\d+:\d+:\s*/, '');
}

/** Whether the floor holds where `cwd` and `env` point codex, and why not when it does not load. */
function judge(cmd, cwd, env) {
  const listed = features(cmd, cwd, env);
  if (listed.missing || !listed.ok) return { missing: listed.missing, holds: false, loads: false, out: listed.out };
  const pinned = features(cmd, cwd, env, ['-c', BELOW]);
  const holds = ROW.test(listed.out) && !pinned.ok && pinned.out.includes(MINIMUM);
  return { holds, loads: true, out: listed.out };
}

/** The same judgment on `text` as the only config Codex reads, in a scratch home removed after. */
function judgeAlone(cmd, text, env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmd-codex-floor-'));
  try {
    fs.writeFileSync(path.join(home, 'config.toml'), text, 'utf8');
    return judge(cmd, home, { ...env, CODEX_HOME: home });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Null when the floor holds, else the refusal with its fix. */
function waitFloorRefusal(primary, env = process.env) {
  const cmd = env.SPECSMD_CODEX || 'codex';
  const here = judge(cmd, primary, env);
  if (here.holds) return null;
  if (here.missing) {
    return `The wait floor check runs codex features list, and ${cmd} is not on PATH here. Put codex on PATH or set ` +
      'SPECSMD_CODEX to it, then run the frontier again.';
  }
  // A config that names the minimum is the floor's own failure, so it gets the floor's fix.
  if (!here.loads && !here.out.includes(MINIMUM)) {
    return `Codex cannot load its config in ${primary}: ${cause(here.out)}. Correct what it names, then run the frontier again.`;
  }
  const P = path.join(primary, '.codex', 'config.toml');
  const project = fs.existsSync(P) ? fs.readFileSync(P, 'utf8') : '';
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (project && judgeAlone(cmd, project, env).holds) {
    return `${P} holds the wait floor, but Codex reads a project config only in a trusted project, and ${primary} is ` +
      `not one. Start codex in ${primary} and accept the trust prompt, or set trust_level = "trusted" in the [projects] ` +
      `entry for ${primary} in ${path.join(home, 'config.toml')}.`;
  }
  const same = `Codex applies no wait floor in ${primary}, so wait_agent can wake the orchestrator before a builder returns.`;
  const table = FRAGMENT.join('\n');
  const appended = judgeAlone(cmd, `${project}${project && !project.endsWith('\n') ? '\n' : ''}${table}\n`, env);
  if (appended.holds) return `${same} Append this table at the end of ${P}, creating the file if it is missing:\n${table}`;
  if (appended.loads) {
    return `${same} Codex loads ${P} with this table appended and the floor still does not hold, so a config layer ` +
      `outside ${P} and ${path.join(home, 'config.toml')} turns it off. Remove the multi_agent_v2 setting from that layer, ` +
      'then run the frontier again.';
  }
  return `${same} Codex cannot load ${P} with this table appended (${cause(appended.out)}). Rewrite every multi_agent_v2 setting in that ` +
    `file as this one table, keeping the other keys it sets, and turn an inline features = { } into a [features] table:\n${table}`;
}

module.exports = { FLOOR, FRAGMENT, waitFloorRefusal };
