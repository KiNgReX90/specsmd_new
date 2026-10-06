const fs = require('fs-extra');
const path = require('path');
const { lockPath, readLock, serializeLock, entryHash, blockText } = require('./lock');
const { checkBudget } = require('./budget');

class InstallError extends Error {
    constructor(message, code, files = []) {
        super(message);
        this.code = code;
        this.files = files;
    }
}

/** Reads a host file, or null when it is absent. */
async function readHost(abs) {
    try {
        return await fs.readFile(abs);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

/**
 * Records the state of every path before it changes and puts all of it back on failure:
 * a file gets its bytes and mode, a path that was absent is removed again, and a directory
 * the install created is removed when it is empty again.
 */
class Journal {
    constructor(root) {
        this.root = root;
        this.saved = new Map();
        this.createdDirs = [];
    }

    abs(rel) {
        return path.join(this.root, ...rel.split('/'));
    }

    async save(rel) {
        if (this.saved.has(rel)) return;
        const abs = this.abs(rel);
        const stat = await fs.lstat(abs).catch(() => null);
        if (!stat) this.saved.set(rel, null);
        else if (stat.isSymbolicLink()) this.saved.set(rel, { link: await fs.readlink(abs) });
        else this.saved.set(rel, { content: await fs.readFile(abs), mode: stat.mode & 0o777 });
    }

    async ensureDir(dir) {
        const missing = [];
        for (let at = dir; at.startsWith(this.root) && at !== this.root; at = path.dirname(at)) {
            if (await fs.pathExists(at)) break;
            missing.push(at);
        }
        await fs.ensureDir(dir);
        this.createdDirs.push(...missing);
    }

    async write(rel, content, mode) {
        await this.save(rel);
        const abs = this.abs(rel);
        await this.ensureDir(path.dirname(abs));
        await fs.writeFile(abs, content);
        if (mode !== undefined) await fs.chmod(abs, mode);
    }

    async remove(rel) {
        await this.save(rel);
        await fs.remove(this.abs(rel));
        // Prune directories the removal left empty, never the host root.
        for (let dir = path.dirname(this.abs(rel)); dir.startsWith(this.root) && dir !== this.root; dir = path.dirname(dir)) {
            if ((await fs.readdir(dir)).length > 0) break;
            await fs.rmdir(dir);
        }
    }

    async restoreOne(rel, previous) {
        const abs = this.abs(rel);
        const current = await fs.lstat(abs).catch(() => null);
        if (!previous) {
            if (current) await fs.remove(abs);
            return;
        }
        if (previous.link !== undefined) {
            if (current) await fs.remove(abs);
            await fs.ensureDir(path.dirname(abs));
            await fs.symlink(previous.link, abs);
            return;
        }
        // Write in place: the path that failed may sit in a directory that refuses an unlink.
        if (current && current.isFile() && (await fs.readFile(abs)).equals(previous.content)) return;
        if (current && !current.isFile()) await fs.remove(abs);
        await fs.ensureDir(path.dirname(abs));
        await fs.writeFile(abs, previous.content);
        await fs.chmod(abs, previous.mode);
    }

    /** Puts every saved path back; one path that fails does not stop the others. */
    async restore() {
        const failures = [];
        for (const [rel, previous] of [...this.saved.entries()].reverse()) {
            try {
                await this.restoreOne(rel, previous);
            } catch (error) {
                failures.push(`${rel}: ${error.message}`);
            }
        }
        for (const dir of [...this.createdDirs].sort((a, b) => b.length - a.length)) {
            const entries = await fs.readdir(dir).catch(() => null);
            if (entries && entries.length === 0) await fs.rmdir(dir).catch((error) => failures.push(`${dir}: ${error.message}`));
        }
        if (failures.length > 0) throw new Error(failures.join('\n'));
    }
}

/** Paths whose host content no longer matches the previous lock, so the host edited them. */
async function hostEdits(root, oldLock, files) {
    const edited = [];
    for (const [rel, entry] of Object.entries(oldLock.files)) {
        const host = await readHost(path.join(root, rel));
        if (host === null || entryHash(host, entry) === entry.sha256) continue;
        const planned = files.get(rel);
        if (planned && planned.content.equals(host)) continue;
        edited.push(rel);
    }
    return edited.sort();
}

/** The host content after removing a block the flow no longer installs. */
function withoutBlock(text, block) {
    const found = blockText(text, block);
    if (found === null) return null;
    const at = text.indexOf(found);
    let end = at + found.length;
    if (text[end] === '\r') end += 1;
    if (text[end] === '\n') end += 1;
    return text.slice(0, at) + text.slice(end);
}

/**
 * Applies a staged install to the host as one transaction: refuse host edits unless forced,
 * name every unrecorded host file it overwrites, write, remove what the old lock recorded
 * and the new install drops, write the lock, run the budget check, and restore the previous
 * state on any failure.
 */
async function applyInstall({ root, flowKey, staged, extras, force, version, sourceCommit, log }) {
    const { files, links, dirs } = staged;
    const oldLock = await readLock(root, flowKey);
    const previous = oldLock ? oldLock.files : {};

    if (oldLock) {
        const edited = await hostEdits(root, oldLock, files);
        if (edited.length > 0 && !force) {
            throw new InstallError(
                `the host edited ${edited.length} installed file(s); install with force to overwrite:\n` +
                edited.map((rel) => `  ${rel}`).join('\n'),
                'HOST_EDITED',
                edited,
            );
        }
    }

    for (const [rel, file] of files) {
        if (previous[rel]) continue;
        const host = await readHost(path.join(root, rel));
        if (host !== null && !host.equals(file.content)) log(`  overwriting host file ${rel}`);
    }

    const journal = new Journal(root);
    try {
        for (const rel of [...files.keys()].sort()) {
            const file = files.get(rel);
            await journal.write(rel, file.content, file.mode);
        }
        for (const [rel, target] of links) {
            if (await fs.lstat(journal.abs(rel)).catch(() => null)) continue;
            await journal.save(rel);
            await journal.ensureDir(path.dirname(journal.abs(rel)));
            await fs.symlink(target, journal.abs(rel));
        }
        for (const rel of dirs) await journal.ensureDir(journal.abs(rel));

        for (const rel of Object.keys(previous).sort()) {
            if (files.has(rel)) continue;
            const entry = previous[rel];
            if (entry.block) {
                const host = await readHost(journal.abs(rel));
                const next = host === null ? null : withoutBlock(host.toString('utf8'), entry.block);
                if (next !== null) await journal.write(rel, next);
            } else if (await readHost(journal.abs(rel)) !== null) {
                log(`  removing ${rel}, which this install no longer writes`);
                await journal.remove(rel);
            }
        }

        for (const [rel, content] of extras) await journal.write(rel, content);
        await journal.write(lockPath(flowKey), serializeLock({ flowKey, version, sourceCommit, files }));

        const refusal = checkBudget(root);
        if (refusal) throw new InstallError(`the installed flow text is over its budget:\n${refusal}`, 'OVER_BUDGET');
    } catch (error) {
        try {
            await journal.restore();
        } catch (restoreError) {
            error.message += `\nrestoring the previous state also failed: ${restoreError.message}`;
        }
        throw error;
    }
    return files.size;
}

module.exports = { applyInstall, InstallError };
