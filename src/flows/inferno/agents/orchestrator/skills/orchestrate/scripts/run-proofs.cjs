'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');
const lib = require('./run-lib.cjs');

const DEFAULT_CONFIG = `${lib.SPECS_DIR}/config.yaml`;
const digest = (value) => createHash('sha256').update(value).digest('hex');

function gitFields(tree, args) {
  const result = spawnSync('git', args, { cwd: tree, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new lib.RunError(`cannot read verification inputs: ${result.stderr}`, 'GIT');
  return result.stdout.split('\0').filter(Boolean);
}

/** Hash the effective code contents under a command's globs. */
function scopeHash(tree, scope) {
  const included = (file) => file !== lib.SPECS_DIR && !file.startsWith(`${lib.SPECS_DIR}/`) &&
    (!scope || lib.matchesAny(file, scope));
  const entries = new Map();
  for (const row of gitFields(tree, ['ls-tree', '-rz', 'HEAD'])) {
    const separator = row.indexOf('\t');
    const file = row.slice(separator + 1);
    if (included(file)) entries.set(file, row.slice(0, separator));
  }
  const dirty = new Set([
    ...gitFields(tree, ['diff', '--name-only', '-z', 'HEAD']),
    ...gitFields(tree, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  for (const file of dirty) {
    if (!included(file)) continue;
    const full = path.join(tree, file);
    let stat;
    try { stat = fs.lstatSync(full); } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      entries.delete(file);
      continue;
    }
    if (stat.isDirectory()) {
      entries.set(file, `160000 commit ${lib.git(full, ['rev-parse', 'HEAD'])}`);
      continue;
    }
    const content = stat.isSymbolicLink() ? fs.readlinkSync(full, { encoding: 'buffer' }) : fs.readFileSync(full);
    const object = spawnSync('git', ['hash-object', '--stdin'], { cwd: tree, input: content, encoding: 'utf8' });
    if (object.status !== 0) throw new lib.RunError(`cannot hash verification input: ${file}`, 'GIT');
    const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o100 ? '100755' : '100644';
    entries.set(file, `${mode} blob ${object.stdout.trim()}`);
  }
  const sorted = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return digest(JSON.stringify([scope ? [...scope].sort() : null, sorted]));
}

function commandProof(tree, config, selected, command) {
  const file = path.relative(tree, path.resolve(tree, selected || DEFAULT_CONFIG));
  const scope = config.verification && config.verification.finalize_scopes && config.verification.finalize_scopes[command];
  const hash = scopeHash(tree, scope);
  const key = digest(JSON.stringify([command, file, hash]));
  return { command, config: file, hash, file: path.join(lib.cacheDir(tree), 'green-commands', key) };
}

function readProof(proof) {
  try {
    const record = JSON.parse(fs.readFileSync(proof.file, 'utf8'));
    return record.command === proof.command && record.config === proof.config && record.hash === proof.hash &&
      Number.isFinite(record.seconds) && record.seconds >= 0 && Number.isFinite(Date.parse(record.stamp)) &&
      typeof record.branch === 'string' ? record : null;
  } catch (error) {
    return null;
  }
}

/** Only a successful command on unchanged inputs can mint a proof. */
function runCommand(tree, config, selected, command, log) {
  const proof = commandProof(tree, config, selected, command);
  const previous = readProof(proof);
  if (previous) return { command, result: 'green', seconds: previous.seconds, stamp: previous.stamp };
  const run = lib.runShell(command, tree, log);
  const moved = run.code === 0 && commandProof(tree, lib.readConfig(tree, selected), selected, command).file !== proof.file;
  if (run.code !== 0 || moved) {
    fs.rmSync(proof.file, { force: true });
    if (moved) fs.appendFileSync(log, '\nverification inputs changed while the command ran. Run it again.\n');
    return { command, result: 'fail', seconds: run.seconds, log: run.log, ...(moved ? { moved: true } : {}) };
  }
  const { file, ...identity } = proof;
  const record = { ...identity, stamp: new Date().toISOString(), seconds: run.seconds, branch: lib.currentBranch(tree) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify(record)}\n`);
  fs.renameSync(pending, file);
  return { command, result: 'pass', seconds: run.seconds };
}

module.exports = { commandProof, readProof, runCommand, scopeHash };
