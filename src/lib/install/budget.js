const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** The machine-level flow text budget script, or null when this machine has none. */
function findBudgetScript(env = process.env) {
    const script = env.INFERNO_FLOW_BUDGET ||
        path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
            'specsmd-inferno', 'flow-text-budget.py');
    return fs.existsSync(script) ? script : null;
}

/**
 * Runs the budget script on the host root. Returns null when the text is within budget or
 * no script exists, and the script's output when it refuses.
 */
function checkBudget(root, env = process.env) {
    const script = findBudgetScript(env);
    if (!script) return null;
    const result = spawnSync('python3', [script, '--repo', root, '--quiet'], { encoding: 'utf8', env });
    if (result.error) return `the budget script ${script} could not run: ${result.error.message}`;
    if (result.status === 0) return null;
    return `${result.stdout || ''}${result.stderr || ''}`.trim() || `the budget script exited ${result.status}`;
}

module.exports = { findBudgetScript, checkBudget };
