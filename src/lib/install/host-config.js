const fs = require('fs-extra');
const path = require('path');

/** The Codex fleet's INFERNO config, which every Codex run.cjs call names with --config. */
const CODEX_CONFIG = '.specs-inferno/config.codex.yaml';

/**
 * The text of a config with `host: <host>` above its first top-level key, or null when the
 * config already declares a host.
 */
function withHost(text, host) {
    if (/^host\s*:/m.test(text)) return null;
    const lines = text.split('\n');
    const at = lines.findIndex((line) => /^[A-Za-z_][\w-]*\s*:/.test(line));
    if (at === -1) return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}host: ${host}\n`;
    lines.splice(at, 0, `host: ${host}`, '');
    return lines.join('\n');
}

/**
 * The host config edits an install makes, as [rel, content] pairs the install transaction
 * writes and restores with the rest. The run scripts read a config with no `host` key as a
 * Claude host's, so a Codex config written before the key would print Claude agent names on
 * the Codex fleet: an install carrying the codex tool declares `host: codex` in it. The lock
 * never records the edit, because the config stays the host's own file.
 */
async function hostConfigEdits(root, toolKeys) {
    if (!toolKeys.includes('codex')) return [];
    const abs = path.join(root, ...CODEX_CONFIG.split('/'));
    if (!await fs.pathExists(abs)) return [];
    const next = withHost(await fs.readFile(abs, 'utf8'), 'codex');
    return next === null ? [] : [[CODEX_CONFIG, next]];
}

module.exports = { CODEX_CONFIG, hostConfigEdits, withHost };
