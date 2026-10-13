'use strict';

/**
 * `run.cjs mutate --batch <file>`: every mistake of a review in one call.
 *
 * Each Rust mistake costs a build, so the Rust entries share one. Every switchable entry is
 * written into its file at once behind a switch that is off by default (run-mutate-rust.cjs).
 * A control run then proves each distinct test green with every switch off. A switch the build
 * refuses is blamed from the compiler's file:line and moved to its own build, and the control
 * runs again. A test that is red with every switch off stops the batch with no verdict at all,
 * because it is red before any mistake. Then each entry's test runs with only its own switch on:
 * the build is done, so a red run is the test noticing. An entry no switch can hold (an
 * attribute line, a string, a const item, a switch that did not compile) takes a classic
 * in-place build of its own, and every other language runs its test once in place.
 *
 * A clean tree only, every touched file restored in a finally, and signals held until then.
 * A held signal is read before every run, so the batch starts no run after it, and every entry
 * still to run reads not run. One journal covers every file (run-mutate-journal.cjs), so a run
 * killed outright is put back by the next step that reads the tree.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { afterRecovery, openSession, recoverInterrupted } = require('./run-mutate-journal.cjs');
const { readBatch } = require('./run-mutate-entries.cjs');
const { applySwitches, blame, planRust } = require('./run-mutate-rust.cjs');
const { readLog, verdictOf } = require('./run-mutate-verdict.cjs');

const { RunError } = lib;
const OFF = 'unset INFERNO_MUTANT; ';
const ON = (k) => `export INFERNO_MUTANT=${k}; `;

/** The plan of every entry: a switch for the Rust ones that can hold one, the classic build otherwise. */
function planAll(tree, entries) {
  const plans = new Map(entries.filter((e) => !e.rust).map((e) => [e.k, { form: 'classic' }]));
  for (const rel of [...new Set(entries.filter((e) => e.rust).map((e) => e.rel))]) {
    const mine = entries.filter((e) => e.rust && e.rel === rel);
    const text = fs.readFileSync(path.join(tree, rel), 'utf8');
    planRust(text, mine).forEach((plan, index) => plans.set(mine[index].k, plan));
  }
  return plans;
}

function writeSwitches(session, switched, plans, written) {
  const files = new Set(switched.map((e) => e.rel));
  for (const rel of written) if (!files.has(rel)) session.putBack(rel);
  for (const rel of files) {
    const items = switched.filter((e) => e.rel === rel).map((e) => plans.get(e.k));
    session.write(rel, applySwitches(session.original(rel), items));
  }
  return files;
}

/** The stop line once a signal is held, so no run starts after it; null otherwise. */
async function signalled(session) {
  const signal = await session.received();
  return signal ? `the batch stopped on ${signal}, so every entry still to run reads not run` : null;
}

/** Each distinct test once with every switch off: ok, the failed build's text, or a reason to stop. */
async function control(session, switched, round) {
  const tests = [...new Set(switched.map((e) => e.test))];
  for (const [index, test] of tests.entries()) {
    const signal = await signalled(session);
    if (signal) return { signal };
    const run = lib.runShell(OFF + test, session.tree, session.log(`control-${round}-${index + 1}`));
    if (run.code === 0 && !run.signal) continue;
    const text = readLog(run.log);
    const verdict = verdictOf(run, text, null);
    if (verdict.why === 'did not build') return { text };
    if (verdict.caught) {
      return { stop: `the test ${test} is red with every switch off (exit ${run.code} -> ${run.log}), so it is red before any mistake and no entry has a verdict` };
    }
    return { stop: `the control run of ${test} has no verdict, ${verdict.why} (-> ${run.log}), so no entry has one` };
  }
  return { ok: true };
}

function execute(session, e, prefix, label) {
  const run = lib.runShell(prefix + e.test, session.tree, session.log(label));
  return { ...verdictOf(run, readLog(run.log), e.abs), code: run.code, log: run.log, signal: run.signal };
}

async function runAll(session, entries, plans) {
  const verdicts = new Map();
  let builds = 0;
  let switched = entries.filter((e) => plans.get(e.k).form === 'switch');
  let written = new Set();
  while (switched.length > 0) {
    written = writeSwitches(session, switched, plans, written);
    builds += 1;
    const result = await control(session, switched, builds);
    if (result.ok) break;
    if (result.signal) return { builds, verdicts, stopped: result.signal };
    if (result.stop) return { builds, stopped: result.stop };
    const blamed = new Set(blame(result.text, switched));
    for (const k of blamed) plans.set(k, { form: 'classic', why: 'its switch did not compile' });
    switched = switched.filter((e) => !blamed.has(e.k));
  }
  for (const e of switched) {
    const signal = await signalled(session);
    if (signal) return { builds, verdicts, stopped: signal };
    const verdict = execute(session, e, ON(e.k), `switch-${e.k}`);
    verdicts.set(e.k, verdict);
    if (verdict.signal) return { builds, verdicts, stopped: `the test of entry ${e.k} ended on ${verdict.signal}, so the batch stopped` };
  }
  for (const rel of written) session.putBack(rel);
  for (const e of entries.filter((item) => plans.get(item.k).form === 'classic')) {
    const signal = await signalled(session);
    if (signal) return { builds, verdicts, stopped: signal };
    const line = session.original(e.rel).split('\n')[e.n - 1];
    session.write(e.rel, new Map([[e.n, line.slice(0, e.col) + e.replace + line.slice(e.col + e.find.length)]]));
    const verdict = execute(session, e, OFF, `own-${e.k}`);
    session.putBack(e.rel);
    if (e.rust) builds += 1;
    verdicts.set(e.k, verdict);
    if (verdict.signal) return { builds, verdicts, stopped: `the test of entry ${e.k} ended on ${verdict.signal}, so the batch stopped` };
  }
  return { builds, verdicts };
}

const yamlText = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function rowOf(e, plan, verdict) {
  const own = e.rust && plan.form === 'classic' ? plan.why : undefined;
  const base = { criterion: e.criterion, file: e.rel, line: e.n, test: e.test, form: plan.form, own };
  if (!verdict) return { ...base, caught: null, why: 'not run' };
  return { ...base, caught: verdict.caught, why: verdict.why, code: verdict.code, log: verdict.log };
}

function lineOf(row) {
  const said = row.caught === true ? 'caught yes' : row.caught === false ? 'caught no' : `no verdict: ${row.why}`;
  return `${said} | ${row.file}:${row.line} | ${row.criterion}${row.own ? ` | own build: ${row.own}` : ''}`;
}

function report(session, recovered, entries, plans, result) {
  if (!result.verdicts) {
    return { exit: 2, payload: { stopped: result.stopped, builds: result.builds, restored: true }, out: [...recovered, result.stopped, 'every file is restored'] };
  }
  const rows = entries.map((e) => rowOf(e, plans.get(e.k), result.verdicts.get(e.k)));
  const rust = entries.filter((e) => e.rust);
  const switched = rust.filter((e) => plans.get(e.k).form === 'switch').length;
  const others = entries.length - rust.length;
  const counted = `${plural(result.builds, 'build', 'builds')} for ${plural(rust.length, 'Rust entry', 'Rust entries')} ` +
    `(${switched} switched, ${rust.length - switched} on a build of their own)` +
    (others > 0 ? `; ${plural(others, 'other entry', 'other entries')} ran a test once in place` : '');
  const paste = rows.filter((row) => row.caught !== null)
    .flatMap((row) => [`  - criterion: ${yamlText(row.criterion)}`, `    test: ${yamlText(row.test)}`, `    caught: ${row.caught ? 'yes' : 'no'}`]);
  const file = session.log('mutants').replace(/\.log$/, '.yaml');
  fs.writeFileSync(file, paste.length > 0 ? `${paste.join('\n')}\n` : '');
  const out = [...recovered, ...rows.map(lineOf), counted, ...(result.stopped ? [result.stopped] : [])];
  if (paste.length > 0 && out.length + paste.length + 1 <= 30) out.push('paste under mutants:', ...paste);
  else if (paste.length > 0) out.push(`paste under mutants: the lines in ${file}`);
  return {
    exit: result.stopped ? 2 : 0,
    payload: { builds: result.builds, rust: rust.length, switched, entries: rows, paste: file, restored: true, stopped: result.stopped },
    out,
  };
}

/** The batch's result, a promise: the batch yields a tick before each run so a held signal stops it. */
async function batch(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const file = path.resolve(options.cwd || process.cwd(), options.batch);
  const recovered = recoverInterrupted(tree);
  const rel = path.relative(tree, file).split(path.sep).join('/');
  const dirty = lib.dirtyPaths(tree, rel.startsWith('../') || path.isAbsolute(rel) ? [] : [rel]);
  if (dirty.length > 0) {
    throw new RunError(afterRecovery(recovered,
      `refusing to mutate a dirty tree: ${dirty.slice(0, 5).join(', ')} is uncommitted. Mutate once the tree is clean.`), 'DIRTY');
  }
  const entries = readBatch(tree, file);
  const plans = planAll(tree, entries);
  const session = openSession(tree);
  let result = null;
  let failed = [];
  try {
    result = await runAll(session, entries, plans);
  } finally {
    failed = session.close();
  }
  if (failed.length > 0) return { exit: 2, payload: { restored: false, failed }, out: [...recovered, ...failed] };
  return report(session, recovered, entries, plans, result);
}

module.exports = { batch };
