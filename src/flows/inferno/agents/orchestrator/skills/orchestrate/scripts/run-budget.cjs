'use strict';

/**
 * Where the flow text budget script lives, shared by the claim and the installer so the two
 * never disagree: config `budget.script` first, then INFERNO_FLOW_BUDGET, then
 * $XDG_DATA_HOME/specsmd-inferno/flow-text-budget.py. Node builtins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function expandHome(file, env) {
  if (file !== '~' && !file.startsWith('~/')) return file;
  return path.join(env.HOME || os.homedir(), file.slice(1));
}

/**
 * Returns { script } when a script exists to run, { missing } when the configured script is
 * absent, which refuses, and { skip } with the line to print when the unconfigured lookup
 * finds nothing.
 */
function resolveBudget(config, root, env = process.env) {
  const configured = config && config.budget && config.budget.script;
  if (configured) {
    const script = path.resolve(root, expandHome(String(configured), env));
    return fs.existsSync(script) ? { script } : { missing: `budget.script names ${script}, which does not exist` };
  }
  const script = env.INFERNO_FLOW_BUDGET ||
    path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'specsmd-inferno', 'flow-text-budget.py');
  return fs.existsSync(script) ? { script } : { skip: `SKIP budget (no script at ${script})` };
}

module.exports = { resolveBudget };
