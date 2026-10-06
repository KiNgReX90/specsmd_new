'use strict';

/**
 * `run.cjs mutate`: the reviewer's mutant. It breaks one line of a committed file in place,
 * runs the test that should notice, and puts the line back whatever happens.
 *
 * In place, because a fresh copy of the tree has no dependencies and no build cache, so a
 * mutant there costs a full install or compile. That is safe only on a clean tree, so a dirty
 * one is refused. The restore runs in a finally, a signal is held until it has run, and a run
 * killed outright leaves a journal that the next call restores from before it starts.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

const { RunError } = lib;
const USAGE = 'usage: node run.cjs mutate --file <f> --line <n> --replace <text> --test <cmd> [--tree <dir>]';
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function journalPath(tree) {
  return path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'mutate-journal.json');
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Put back a mutant an earlier run left behind when it was killed before its restore. A run
 * that is still alive owns its mutant, so the tree is refused instead of reverted under it.
 * Every step that refuses a dirty tree calls this first, so a leftover is never committed.
 */
function recoverInterrupted(tree) {
  const journal = journalPath(tree);
  if (!fs.existsSync(journal)) return [];
  let entry = null;
  try {
    entry = JSON.parse(fs.readFileSync(journal, 'utf8'));
  } catch (error) {
    entry = null;
  }
  if (entry && Number.isInteger(entry.pid) && entry.pid !== process.pid && alive(entry.pid)) {
    throw new RunError(
      `another mutate (pid ${entry.pid}) is running on ${entry.file}; wait for it, then run this again`,
      'MUTATE_RUNNING'
    );
  }
  const out = [];
  const abs = entry && path.join(tree, entry.file);
  if (entry && fs.existsSync(abs) && sha(fs.readFileSync(abs)) === entry.mutant) {
    lib.git(tree, ['checkout', '--', entry.file]);
    out.push(`restored ${entry.file} from an interrupted mutate`);
  }
  fs.rmSync(journal, { force: true });
  return out;
}

/** Write the original back, then let git restore what the write could not. Null when the file is whole again. */
function restore(tree, rel, abs, original) {
  try {
    fs.writeFileSync(abs, original);
  } catch (error) {
    // git checkout below is the second way back.
  }
  lib.git(tree, ['checkout', '--', rel], { tolerate: true });
  let now = null;
  try {
    now = fs.readFileSync(abs);
  } catch (error) {
    now = null;
  }
  const whole = now !== null && now.equals(original) &&
    lib.gitLines(tree, ['status', '--porcelain', '--', rel], { tolerate: true }).length === 0;
  return whole ? null : `the restore of ${rel} failed; run git checkout -- ${rel} in ${tree} by hand`;
}

function target(tree, options) {
  const rel = path.relative(tree, path.resolve(tree, options.file)).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw new RunError(`${options.file} is outside ${tree}`, 'BAD_TARGET');
  if (lib.git(tree, ['ls-files', '--error-unmatch', '--', rel], { tolerate: true }) === null) {
    throw new RunError(`${rel} is not a committed file, so nothing could restore it`, 'BAD_TARGET');
  }
  const abs = path.join(tree, rel);
  const original = fs.readFileSync(abs);
  const lines = original.toString('utf8').split('\n');
  const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  const n = Number(options.line);
  if (!Number.isInteger(n) || n < 1 || n > count) throw new RunError(`--line ${options.line} is not a line of ${rel} (1 to ${count})`, 'BAD_TARGET');
  if (lines[n - 1] === options.replace) throw new RunError(`--replace leaves ${rel}:${n} as it is, so it is no mutant`, 'BAD_TARGET');
  lines[n - 1] = options.replace;
  return { rel, abs, n, original, mutant: Buffer.from(lines.join('\n'), 'utf8') };
}

function mutate(options) {
  if (!options.file || !options.line || options.replace === undefined || !options.test) {
    throw new RunError(USAGE, 'BAD_ARGS', 1);
  }
  const tree = options.tree || lib.repoRoot(options.cwd);
  const out = recoverInterrupted(tree);
  const dirty = lib.dirtyPaths(tree);
  if (dirty.length > 0) {
    throw new RunError(
      `refusing to mutate a dirty tree: ${dirty.slice(0, 5).join(', ')} is uncommitted. Mutate once the tree is clean.`,
      'DIRTY'
    );
  }
  const { rel, abs, n, original, mutant } = target(tree, options);
  const journal = journalPath(tree);
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.writeFileSync(journal, `${JSON.stringify({ file: rel, mutant: sha(mutant), pid: process.pid })}\n`);
  // A listener replaces the default action, so a signal now waits for the restore below.
  const hold = () => {};
  for (const signal of SIGNALS) process.on(signal, hold);
  let run = null;
  let failed = null;
  try {
    fs.writeFileSync(abs, mutant);
    run = lib.runShell(options.test, tree, path.join(path.dirname(journal), `mutate-${lib.stamp()}-${process.pid}.log`));
  } finally {
    failed = restore(tree, rel, abs, original);
    if (!failed) fs.rmSync(journal, { force: true });
    for (const signal of SIGNALS) process.removeListener(signal, hold);
  }
  const at = `${rel}:${n}`;
  if (failed) return { exit: 2, payload: { restored: false, file: rel, line: n }, out: [...out, failed] };
  if (!run || run.signal) {
    const how = run ? `ended on ${run.signal}` : 'never ran';
    return { exit: 2, payload: { restored: true, file: rel, line: n, signal: run && run.signal }, out: [...out, `the test ${how}, so there is no verdict; ${at} is restored`] };
  }
  const caught = run.code !== 0;
  return {
    exit: 0,
    payload: { caught, file: rel, line: n, test: options.test, code: run.code, log: run.log },
    out: [...out, `caught ${caught ? 'yes' : 'no'}`, `  mutant ${at}`, `  test exit ${run.code} -> ${run.log}`],
  };
}

module.exports = { mutate, recoverInterrupted };
