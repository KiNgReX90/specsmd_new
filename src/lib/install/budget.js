const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

// The claim owns the lookup, so the installer and a run never look in different places.
const { resolveBudget } = require('../../flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-budget.cjs');

function hostConfig(root, flowKey) {
    const abs = path.join(root, `.specs-${flowKey}`, 'config.yaml');
    if (!fs.existsSync(abs)) return {};
    return yaml.load(fs.readFileSync(abs, 'utf8')) || {};
}

/**
 * Runs the budget script on the host root. Returns null when the text is within budget or
 * the lookup found no script, which it logs, and { code, message } when it refuses.
 */
function checkBudget(root, { flowKey = 'inferno', env = process.env, log = () => {} } = {}) {
    const found = resolveBudget(hostConfig(root, flowKey), root, env);
    if (found.missing) return { code: 'BUDGET_MISSING', message: found.missing };
    if (found.skip) {
        log(`  ${found.skip}`);
        return null;
    }
    const result = spawnSync('python3', [found.script, '--repo', root, '--quiet'], { encoding: 'utf8', env });
    if (result.error) return { code: 'OVER_BUDGET', message: `the budget script ${found.script} could not run: ${result.error.message}` };
    if (result.status === 0) return null;
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return { code: 'OVER_BUDGET', message: output || `the budget script exited ${result.status}` };
}

module.exports = { checkBudget };
