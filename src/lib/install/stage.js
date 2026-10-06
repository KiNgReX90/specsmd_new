const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const InstallerFactory = require('../InstallerFactory');
const { blockText } = require('./lock');

// Flow resources copied under .specsmd/<flow>/ when the flow ships them.
const FLOW_DIRS = ['agents', 'agent-capabilities', 'bolt-types', 'skills', 'templates', 'shared', 'scripts'];
const FLOW_FILES = ['memory-bank.yaml', 'context-config.yaml', 'quick-start.md', 'README.md', 'constitution.md', 'check-lock.cjs'];

function toPosix(rel) {
    return rel.split(path.sep).join('/');
}

async function copyFlowResources(flowPath, targetFlowDir, toolKeys) {
    await fs.ensureDir(targetFlowDir);
    for (const dir of FLOW_DIRS) {
        if (await fs.pathExists(path.join(flowPath, dir))) {
            await fs.copy(path.join(flowPath, dir), path.join(targetFlowDir, dir));
        }
    }
    const files = toolKeys.includes('codex') ? [...FLOW_FILES, 'README.codex.md'] : FLOW_FILES;
    for (const file of files) {
        if (await fs.pathExists(path.join(flowPath, file))) {
            await fs.copy(path.join(flowPath, file), path.join(targetFlowDir, file));
        }
    }
}

/** Every regular file, symlink and empty directory under dir, host-relative and posix. */
async function walk(dir, rel = '', out = { files: [], links: [], dirs: [] }) {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    if (entries.length === 0 && rel) out.dirs.push(toPosix(rel));
    for (const entry of entries) {
        const child = path.join(rel, entry.name);
        if (entry.isSymbolicLink()) out.links.push(toPosix(child));
        else if (entry.isDirectory()) await walk(dir, child, out);
        else out.files.push(toPosix(child));
    }
    return out;
}

/**
 * Runs every tool installer and the flow copy inside an empty staging directory, so the
 * whole install is known as data before a single host file changes. The tool installers
 * write relative to the working directory, so staging moves into it for the duration.
 * Returns { files: Map(rel -> { content, mode, block? }), links: Map(rel -> target), dirs }.
 */
async function stageFlow(flowPath, flowKey, toolKeys, root) {
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specsmd-stage-'));
    const installers = toolKeys.map((key) => InstallerFactory.getInstaller(key)).filter(Boolean);
    const seeds = new Set(installers.flatMap((installer) => installer.seedFiles));
    const blocks = new Map(installers.flatMap((installer) => installer.managedBlocks)
        .map(({ file, block }) => [file, block]));
    const previousCwd = process.cwd();
    try {
        for (const seed of seeds) {
            if (await fs.pathExists(path.join(root, seed))) {
                await fs.copy(path.join(root, seed), path.join(stageDir, seed));
            }
        }
        process.chdir(stageDir);
        try {
            for (const installer of installers) {
                await installer.installCommands(flowPath, {});
            }
            await copyFlowResources(flowPath, path.join('.specsmd', flowKey), toolKeys);
        } finally {
            process.chdir(previousCwd);
        }

        const found = await walk(stageDir);
        const files = new Map();
        for (const rel of found.files) {
            const abs = path.join(stageDir, rel);
            const content = await fs.readFile(abs);
            const mode = (await fs.stat(abs)).mode & 0o777;
            if (blocks.has(rel)) {
                if (blockText(content.toString('utf8'), blocks.get(rel)) === null) continue;
                files.set(rel, { content, mode, block: blocks.get(rel) });
            } else if (!seeds.has(rel)) {
                files.set(rel, { content, mode });
            }
        }
        const links = new Map();
        for (const rel of found.links) {
            links.set(rel, await fs.readlink(path.join(stageDir, rel)));
        }
        return { files, links, dirs: found.dirs };
    } finally {
        await fs.remove(stageDir);
    }
}

module.exports = { stageFlow, toPosix };
