'use strict';

/**
 * The journal that puts back what a killed `run.cjs mutate` left. A mutate writes it before it
 * touches a file and drops it once every file is whole again, so a run killed outright leaves it,
 * and every step that refuses a dirty tree restores from it first.
 *
 * One mistake records its line, the original line and the hashes before and after. A batch
 * records, per file, the hash of the original, the hash of what it last wrote there and the
 * original text of every line it changed. Recovery writes a file only when it is byte for byte
 * what the mutate wrote, and never looks for a mutant by its text: that guess rewrites lines
 * nobody mutated. A file that already holds its original is left as it is. Any other file, an
 * edit since, a missing file or a journal short of a field, is refused with the journal kept,
 * since a leftover never clears by waiting.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

const { RunError } = lib;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function journalPath(tree) {
  return path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'mutate-journal.json');
}

/** Fields 3 (state) and 22 (start time) of /proc/<pid>/stat, or null. The name in field 2 may hold spaces. */
function procStat(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { state: fields[0], start: fields[19] };
  } catch (error) {
    return null;
  }
}

const PROC = fs.existsSync('/proc/self/stat');

/**
 * Whether the run that wrote the journal still lives. Its pid alone proves nothing: a dead
 * run's pid can go to any process, and a zombie still answers kill(pid, 0). With /proc the
 * owner is the same pid with the same start time, and no zombie. Without /proc, the pid only.
 */
function alive(entry) {
  if (!PROC) {
    try {
      process.kill(entry.pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  }
  const now = procStat(entry.pid);
  return now !== null && now.state !== 'Z' && now.start === entry.start;
}

/** The journal's owner: this process, by pid and start time. */
function owner() {
  const self = procStat('self');
  return { pid: process.pid, start: self && self.start };
}

/** Put back the one line a dead single mutate wrote, and say what happened. */
function putBack(tree, entry, journal) {
  const abs = path.join(tree, entry.file);
  const now = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  const complete = Number.isInteger(entry.line) && typeof entry.original === 'string' &&
    typeof entry.replace === 'string' && typeof entry.before === 'string';
  if (complete && now !== null && sha(now) === entry.before) {
    return `${entry.file} already holds its original; dropped the journal of an interrupted mutate`;
  }
  if (complete && now !== null && sha(now) === entry.mutant) {
    const lines = now.toString('utf8').split('\n');
    lines.splice(entry.line - 1, entry.replace.split('\n').length, entry.original);
    fs.writeFileSync(abs, lines.join('\n'));
    return `restored ${entry.file} from an interrupted mutate`;
  }
  const why = !complete ? 'its journal lacks what a restore needs' : now === null ? 'the file is gone' : 'the file changed since';
  const wrote = Number.isInteger(entry.line) ? ` line ${entry.line} of` : '';
  const as = typeof entry.replace === 'string' ? ` as ${JSON.stringify(entry.replace)}` : '';
  const over = typeof entry.original === 'string' ? ` in place of ${JSON.stringify(entry.original)}` : '';
  throw new RunError(
    `an interrupted mutate wrote${wrote} ${entry.file}${as}${over}, and ${why}, so nothing was restored. ` +
      `Put the original back where the mutant stands, keep every other change, then delete ${journal}`,
    'MUTATE_LEFTOVER'
  );
}

/** Put back one file a dead batch wrote: `{ok, line}` when it is whole again, `{ok: false, why}` otherwise. */
function putBackFile(tree, record) {
  const lines = record && Array.isArray(record.lines) ? record.lines : null;
  const complete = Boolean(lines) && typeof record.file === 'string' && typeof record.before === 'string' &&
    typeof record.mutant === 'string' && lines.every((line) => line && Number.isInteger(line.line) && typeof line.original === 'string');
  if (!complete) return { ok: false, why: 'its journal lacks what a restore needs' };
  const abs = path.join(tree, record.file);
  const now = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  if (now === null) return { ok: false, why: 'the file is gone' };
  if (sha(now) === record.before) return { ok: true, line: `${record.file} already holds its original; dropped the journal of an interrupted mutate` };
  if (sha(now) === record.mutant) {
    const text = now.toString('utf8').split('\n');
    for (const { line, original } of lines) text[line - 1] = original;
    const back = Buffer.from(text.join('\n'), 'utf8');
    if (sha(back) === record.before) {
      fs.writeFileSync(abs, back);
      return { ok: true, line: `restored ${record.file} from an interrupted mutate` };
    }
  }
  return { ok: false, why: 'the file changed since' };
}

function describe(record, why) {
  const lines = record && Array.isArray(record.lines) ? record.lines.filter((line) => line && Number.isInteger(line.line)) : [];
  const which = lines.length > 0 ? ` line${lines.length === 1 ? '' : 's'} ${lines.map((line) => line.line).join(', ')} of` : '';
  const was = lines.map((line) => `line ${line.line} was ${JSON.stringify(line.original)}`).join(', ');
  return `an interrupted batch mutate rewrote${which} ${record && record.file}${was ? ` (${was})` : ''}, and ${why}`;
}

/** Put back every file a dead batch wrote. The files it cannot put back stay in the journal and are refused. */
function putBackFiles(tree, entry, journal) {
  const done = [];
  const refused = [];
  for (const record of entry.files) {
    const result = putBackFile(tree, record);
    if (result.ok) done.push(result.line);
    else refused.push({ record, why: result.why });
  }
  if (refused.length === 0) return done;
  fs.writeFileSync(journal, `${JSON.stringify({ ...entry, files: refused.map((item) => item.record) })}\n`);
  throw new RunError(afterRecovery(done,
    `${refused.map((item) => describe(item.record, item.why)).join('; ')}, so nothing was restored there. ` +
      `Put each original line back where its mutant stands, keep every other change, then delete ${journal}`), 'MUTATE_LEFTOVER');
}

/**
 * Put back a mutant an earlier run left behind when it was killed before its restore. A run
 * that is still alive owns its mutants, so the tree is refused instead of reverted under it,
 * unless `keepLive(file)` says the caller never reads any file it holds. A dead run's leftover
 * that cannot go back byte for byte is refused in every step, whichever item owns the file. Every
 * step that refuses a dirty tree calls this first, so a leftover is never committed, and every
 * journal it drops comes with a line that says why.
 */
function recoverInterrupted(tree, options = {}) {
  const journal = journalPath(tree);
  if (!fs.existsSync(journal)) return [];
  let entry = null;
  try {
    entry = JSON.parse(fs.readFileSync(journal, 'utf8'));
  } catch (error) {
    entry = null;
  }
  const batch = Boolean(entry) && Array.isArray(entry.files);
  if (!entry || (!batch && typeof entry.file !== 'string')) {
    fs.rmSync(journal, { force: true });
    return [`dropped the unreadable mutate journal ${journal}`];
  }
  const files = batch ? entry.files.map((record) => String(record && record.file)) : [entry.file];
  if (Number.isInteger(entry.pid) && entry.pid !== process.pid && alive(entry)) {
    if (options.keepLive && files.every((file) => options.keepLive(file))) return [];
    throw new RunError(
      `another mutate (pid ${entry.pid}) is running on ${files.join(', ') || 'no file yet'}; wait for it, then run this again; ` +
        `if no mutate is running, delete ${journal}`,
      'MUTATE_RUNNING'
    );
  }
  const lines = batch ? putBackFiles(tree, entry, journal) : [putBack(tree, entry, journal)];
  fs.rmSync(journal, { force: true });
  return lines;
}

/** A refusal that comes after a recovery still says what the recovery did. */
const afterRecovery = (restored, message) => [message, ...restored].join('\n');

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

/**
 * Hold the signals that would end this process, until `release` runs after the restore.
 * `release.received()` names the first one held. Node runs the listener only on its event
 * loop, never inside a spawnSync, so a caller that wants to see it between runs yields a tick
 * first.
 */
function holdSignals() {
  let received = null;
  // A listener replaces the default action, so a signal now waits for the restore.
  const hold = (signal) => {
    if (!received) received = signal;
  };
  for (const signal of SIGNALS) process.on(signal, hold);
  const release = () => {
    for (const signal of SIGNALS) process.removeListener(signal, hold);
  };
  release.received = () => received;
  return release;
}

/**
 * The files one batch mutates, with the journal that covers all of them. `write` records a
 * file's new lines in the journal before it writes them; `putBack` writes the original back;
 * `received` names a signal held since the start; `close` restores every file it touched, drops
 * the journal when all are whole, and releases the signals.
 */
function openSession(tree) {
  const journal = journalPath(tree);
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const stamp = `${lib.stamp()}-${process.pid}`;
  const who = owner();
  const files = new Map();
  const save = () => {
    const records = [...files.values()].filter((file) => file.record).map((file) => file.record);
    fs.writeFileSync(journal, `${JSON.stringify({ ...who, files: records })}\n`);
  };
  const touch = (rel) => {
    if (!files.has(rel)) files.set(rel, { abs: path.join(tree, rel), original: fs.readFileSync(path.join(tree, rel)), record: null });
    return files.get(rel);
  };
  save();
  const release = holdSignals();
  return {
    tree,
    /** The first signal held so far, read after a tick of the event loop. */
    async received() {
      await new Promise((resolve) => setImmediate(resolve));
      return release.received();
    },
    log: (label) => path.join(path.dirname(journal), `mutate-batch-${stamp}-${label}.log`),
    original: (rel) => touch(rel).original.toString('utf8'),
    /** Write `changed` (line number to text) over the original of `rel`. */
    write(rel, changed) {
      const file = touch(rel);
      const lines = file.original.toString('utf8').split('\n');
      const record = { file: rel, before: sha(file.original), lines: [] };
      for (const [n, text] of [...changed].sort((a, b) => a[0] - b[0])) {
        record.lines.push({ line: n, original: lines[n - 1] });
        lines[n - 1] = text;
      }
      const mutant = Buffer.from(lines.join('\n'), 'utf8');
      file.record = { ...record, mutant: sha(mutant) };
      save();
      fs.writeFileSync(file.abs, mutant);
    },
    putBack(rel) {
      const file = files.get(rel);
      if (!file || !file.record) return;
      fs.writeFileSync(file.abs, file.original);
      file.record = null;
      save();
    },
    close() {
      const failed = [];
      for (const [rel, file] of files) {
        const why = restore(tree, rel, file.abs, file.original);
        if (why) failed.push(why);
        else file.record = null;
      }
      if (failed.length === 0) fs.rmSync(journal, { force: true });
      else save();
      release();
      return failed;
    },
  };
}

module.exports = { afterRecovery, holdSignals, journalPath, openSession, owner, recoverInterrupted, restore, sha };
