const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

// The installed check script owns the hashing, so the installer and a host check never disagree.
const check = require('../../flows/inferno/check-lock.cjs');

const SOURCE_ROOT = path.join(__dirname, '..', '..');

function lockPath(flowKey) {
    return `.specsmd/${flowKey}/${check.LOCK_NAME}`;
}

/** The lock entry for one planned file. */
function entryFor(file) {
    if (!file.block) return { sha256: check.sha256(file.content) };
    return { sha256: check.entryHash(file.content, file), block: file.block };
}

/** The previous lock under root, or null on a first install. */
async function readLock(root, flowKey) {
    const abs = path.join(root, lockPath(flowKey));
    if (!await fs.pathExists(abs)) return null;
    try {
        const lock = JSON.parse(await fs.readFile(abs, 'utf8'));
        return lock && typeof lock.files === 'object' ? lock : { files: {} };
    } catch (error) {
        throw new Error(`cannot read ${lockPath(flowKey)}: ${error.message}`);
    }
}

/**
 * The rule ids a flow declares in its `flow-rules.json`. A rule there holds back work its
 * host completed without it, so it starts per host at the install that first carried it.
 */
function declaredRules(flowKey) {
    const file = path.join(SOURCE_ROOT, 'flows', flowKey, 'flow-rules.json');
    if (!fs.existsSync(file)) return [];
    const declared = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(declared.rules) ? declared.rules : [];
}

/** Each declared rule's start: the previous lock's value when it has one, else `now`. */
function ruleTimes(oldLock, ids, now) {
    const recorded = (oldLock && oldLock.rules) || {};
    return Object.fromEntries(ids.map((id) => [id, typeof recorded[id] === 'string' ? recorded[id] : now]));
}

function serializeLock({ flowKey, version, sourceCommit, rules, files }) {
    const sorted = {};
    for (const rel of [...files.keys()].sort()) sorted[rel] = entryFor(files.get(rel));
    const lock = { flow: flowKey, version, source_commit: sourceCommit };
    if (rules && Object.keys(rules).length > 0) lock.rules = rules;
    lock.files = sorted;
    return `${JSON.stringify(lock, null, 2)}\n`;
}

/** HEAD of the source checkout, or "unknown" when this package is not a tracked checkout. */
function sourceCommit(root = SOURCE_ROOT) {
    const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    const tracked = git(['ls-files', '--error-unmatch', 'lib/installer.js']);
    if (tracked.status !== 0) return 'unknown';
    const head = git(['rev-parse', 'HEAD']);
    const sha = (head.stdout || '').trim();
    return head.status === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown';
}

module.exports = {
    declaredRules,
    ruleTimes,
    lockPath,
    readLock,
    serializeLock,
    sourceCommit,
    entryFor,
    sha256: check.sha256,
    blockText: check.blockText,
    entryHash: check.entryHash,
};
