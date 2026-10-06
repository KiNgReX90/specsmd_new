const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// A model or effort value lands inside frontmatter or a toml string, so it is one plain token
// that never ends in a colon, which YAML would read as a mapping key.
const VALUE = /^[A-Za-z0-9](?:[A-Za-z0-9._:[\]-]*[A-Za-z0-9.\]])?$/;

class RoleError extends Error {
    constructor(message) {
        super(message);
        this.code = 'BAD_ROLE';
    }
}

/** The `roles:` map of a host config file, or {} when the file or the map is absent. */
function readRoles(root, rel) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return {};
    let parsed;
    try {
        parsed = yaml.load(fs.readFileSync(abs, 'utf8'));
    } catch (error) {
        throw new RoleError(`cannot read ${rel}: ${error.message}`);
    }
    const roles = parsed && parsed.roles;
    return roles && typeof roles === 'object' ? roles : {};
}

/** The values a role entry sets, checked, as { field: value } for the keys it names. */
function pick(entry, role, keys) {
    const out = {};
    if (!entry || typeof entry !== 'object') return out;
    for (const [key, field] of keys) {
        if (entry[key] === undefined || entry[key] === null) continue;
        const value = String(entry[key]);
        if (!VALUE.test(value)) {
            throw new RoleError(`roles.${role}.${key} is not a plain model or effort token: ${JSON.stringify(value)}`);
        }
        out[field] = value;
    }
    return out;
}

/**
 * Sets model and effort in a frontmatter that already pins a model. A file with no model
 * line runs on the session's own model (the orchestrator, a launcher) and stays as it is.
 */
function renderFrontmatter(text, values) {
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match || !/^model:/m.test(match[1])) return text;
    let fm = match[1];
    for (const [key, value] of Object.entries(values)) {
        const line = new RegExp(`^${key}:.*$`, 'm');
        if (line.test(fm)) fm = fm.replace(line, `${key}: ${value}`);
        else fm = fm.replace(/^model:.*$/m, (model) => `${model}\n${key}: ${value}`);
    }
    return `---\n${fm}\n---${text.slice(match[0].length)}`;
}

function renderToml(text, values) {
    let out = text;
    for (const [key, value] of Object.entries(values)) {
        out = out.replace(new RegExp(`^${key} = ".*"$`, 'm'), `${key} = "${value}"`);
    }
    return out;
}

/** The Claude role a staged path belongs to, or null. */
function claudeRole(rel, flowKey) {
    const installed = rel.match(new RegExp(`^\\.claude/(?:commands|agents)/specsmd-${flowKey}-([a-z0-9-]+)\\.md$`));
    if (installed) return installed[1];
    const canonical = rel.match(new RegExp(`^\\.specsmd/${flowKey}/agents/([a-z0-9-]+)/agent\\.md$`));
    return canonical ? canonical[1] : null;
}

/** The Codex entry for an installed agent toml: the one whose `agent` names it, else one with no `agent` named after it. */
function codexEntry(rel, flowKey, roles) {
    const match = rel.match(/^\.codex\/agents\/([A-Za-z0-9_]+)\.toml$/);
    if (!match) return null;
    const agent = match[1];
    const entries = Object.entries(roles);
    return entries.find(([, entry]) => entry && entry.agent === agent) ||
        entries.find(([role, entry]) => !(entry && entry.agent) &&
            `specsmd_${flowKey}_${role.replace(/-/g, '_')}` === agent) ||
        null;
}

/**
 * Renders the host's role pins into the staged files in place, so the lock records the
 * rendered bytes. Claude roles come from .specs-<flow>/config.yaml and Codex roles from
 * .specs-<flow>/config.codex.yaml; a role with no entry keeps the source default.
 */
function renderRoles(files, flowKey, root) {
    const claude = readRoles(root, `.specs-${flowKey}/config.yaml`);
    const codex = readRoles(root, `.specs-${flowKey}/config.codex.yaml`);
    for (const [rel, file] of files) {
        const text = file.content.toString('utf8');
        let next = text;
        const role = claudeRole(rel, flowKey);
        if (role) {
            if (claude[role]) next = renderFrontmatter(text, pick(claude[role], role, [['model', 'model'], ['effort', 'effort']]));
        } else {
            const found = codexEntry(rel, flowKey, codex);
            if (found) {
                const [name, entry] = found;
                next = renderToml(text, pick(entry, name, [['model', 'model'], ['reasoning_effort', 'model_reasoning_effort']]));
            }
        }
        if (next !== text) file.content = Buffer.from(next, 'utf8');
    }
}

module.exports = { renderRoles, RoleError };
