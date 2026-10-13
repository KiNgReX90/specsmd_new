'use strict';

/**
 * `run.cjs mutate`: the reviewer's mutant. It breaks one line of a committed file in place,
 * runs the test that should notice, and puts the line back whatever happens. With `--batch` it
 * plants every mistake of a review in one call, the Rust ones on one shared build
 * (run-mutate-batch.cjs).
 *
 * In place, because a fresh copy of the tree has no dependencies and no build cache, so a
 * mutant there costs a full install or compile. That is safe only on a clean tree, so a dirty
 * one is refused. The restore runs in a finally, a signal is held until it has run, and a run
 * killed outright leaves a journal that the next call restores from before it starts
 * (run-mutate-journal.cjs). A red run counts as caught only when the test ran: a build that
 * failed, a file that does not parse and a killed run read no verdict (run-mutate-verdict.cjs).
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const journals = require('./run-mutate-journal.cjs');
const { batch } = require('./run-mutate-batch.cjs');
const { committedFile } = require('./run-mutate-entries.cjs');
const { readLog, verdictOf } = require('./run-mutate-verdict.cjs');

const { RunError } = lib;
const { afterRecovery, recoverInterrupted, sha } = journals;
const USAGE = 'usage: node run.cjs mutate --file <f> --line <n> --replace <text> --test <cmd> [--tree <dir>]\n' +
  '       node run.cjs mutate --batch <file> [--tree <dir>]   a JSON or YAML list of {criterion, file, line, find, replace, test}';

function target(tree, options) {
  const { rel, abs, original, lines, count } = committedFile(tree, options.file);
  const n = Number(options.line);
  if (!Number.isInteger(n) || n < 1 || n > count) throw new RunError(`--line ${options.line} is not a line of ${rel} (1 to ${count})`, 'BAD_TARGET');
  if (lines[n - 1] === options.replace) throw new RunError(`--replace leaves ${rel}:${n} as it is, so it is no mutant`, 'BAD_TARGET');
  const was = lines[n - 1];
  lines[n - 1] = options.replace;
  return { rel, abs, n, was, original, mutant: Buffer.from(lines.join('\n'), 'utf8') };
}

function single(options) {
  if (!options.file || !options.line || options.replace === undefined || !options.test) {
    throw new RunError(USAGE, 'BAD_ARGS', 1);
  }
  const tree = options.tree || lib.repoRoot(options.cwd);
  const out = recoverInterrupted(tree);
  const dirty = lib.dirtyPaths(tree);
  if (dirty.length > 0) {
    throw new RunError(afterRecovery(out,
      `refusing to mutate a dirty tree: ${dirty.slice(0, 5).join(', ')} is uncommitted. Mutate once the tree is clean.`), 'DIRTY');
  }
  const { rel, abs, n, was, original, mutant } = target(tree, options);
  const journal = journals.journalPath(tree);
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const line = { line: n, original: was, replace: options.replace, before: sha(original) };
  fs.writeFileSync(journal, `${JSON.stringify({ file: rel, ...line, mutant: sha(mutant), ...journals.owner() })}\n`);
  const release = journals.holdSignals();
  let run = null;
  let failed = null;
  try {
    fs.writeFileSync(abs, mutant);
    run = lib.runShell(options.test, tree, path.join(path.dirname(journal), `mutate-${lib.stamp()}-${process.pid}.log`));
  } finally {
    failed = journals.restore(tree, rel, abs, original);
    if (!failed) fs.rmSync(journal, { force: true });
    release();
  }
  const at = `${rel}:${n}`;
  if (failed) return { exit: 2, payload: { restored: false, file: rel, line: n }, out: [...out, failed] };
  if (!run || run.signal) {
    const how = run ? `ended on ${run.signal}` : 'never ran';
    return { exit: 2, payload: { restored: true, file: rel, line: n, signal: run && run.signal }, out: [...out, `the test ${how}, so there is no verdict; ${at} is restored`] };
  }
  const verdict = verdictOf(run, readLog(run.log), abs);
  const said = verdict.caught === null ? `no verdict: ${verdict.why}` : `caught ${verdict.caught ? 'yes' : 'no'}`;
  return {
    // A killed run is this machine's failure, not the mutant's; a build that failed is the mutant's.
    exit: verdict.caught === null && /^killed/.test(verdict.why) ? 2 : 0,
    payload: { caught: verdict.caught, why: verdict.why, file: rel, line: n, test: options.test, code: run.code, log: run.log },
    out: [...out, said, `  mutant ${at}`, `  test exit ${run.code} -> ${run.log}`],
  };
}

function mutate(options) {
  if (options.batch !== undefined) {
    if (options.file || options.line || options.replace !== undefined || options.test) throw new RunError(USAGE, 'BAD_ARGS', 1);
    return batch(options);
  }
  return single(options);
}

module.exports = { afterRecovery, mutate, recoverInterrupted };
