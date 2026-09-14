'use strict';

/**
 * `run.cjs probes`: rerun the measurements the planner grounded an item on, against the tree
 * the builder is about to edit. A count taken before a parallel merge moved the file is a
 * number the builder would otherwise trust; three dispatches of 2026-09-06 did exactly that.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

/** A probe is a grep or a count, so a minute is already generous. */
const TIMEOUT_SECONDS = 60;
const MAX_GOT = 120;

/**
 * The words that make an item corrective: it exists because something is defective today. A
 * corrective ui or behavior item owes the diagnosis that measured the cause, because one item
 * of 2026-09-09 named a pixel cause it had never measured (the dials in board-fit.css) while
 * the real cause was a hundred pixels of shelf foot.
 *
 * The vocabulary is deliberately narrow and it is read in the item's own statement of purpose,
 * its title and its opening paragraph, never anywhere in a sixty-line spec. A wider list read
 * over the whole text blocked a deletion item on the phrase "a screen this build no longer
 * ships", and a false block stops a whole run. Under-detection is the safe direction here: the
 * planner is told to carry the block, and this is the floor under that rule.
 */
const CORRECTIVE = /\b(regressions?|defects?|bugs?|broken|misplaced)\b/i;
const DIAGNOSED_KINDS = new Set(['ui', 'behavior']);

/** Title plus opening paragraph: where an item says what it is for. */
function purpose(item) {
  const opening = String(item.description || '').split(/\n\s*\n/)[0] || '';
  return `${item.title || ''}\n${opening}`;
}

function isCorrective(item) {
  if (!DIAGNOSED_KINDS.has(String(item.kind || '').toLowerCase())) return false;
  return CORRECTIVE.test(purpose(item));
}

/**
 * The diagnosis contract: a claim, the bare command that shows it, and the line that command
 * printed. A pixel or a position claim comes from browser geometry, never from adding up
 * declarations, and the probe is what proves it on the tree the builder is about to edit.
 */
function diagnosisErrors(item) {
  const block = item && item.diagnosis;
  const at = `${item.id}: diagnosis`;
  if (block === undefined || block === null) {
    if (!isCorrective(item)) return [];
    return [
      `${item.id}: a corrective ${item.kind} item needs a diagnosis block with claim, probe and shows. ` +
        'Measure the cause on the tree, record the command and the line it printed, and plan the fix at what it shows.',
    ];
  }
  if (typeof block !== 'object' || Array.isArray(block)) {
    return [`${at} must carry claim, probe and shows`];
  }
  const errors = [];
  for (const key of ['claim', 'probe', 'shows']) {
    if (typeof block[key] !== 'string' || block[key].trim().length === 0) {
      errors.push(`${at}.${key} must be a non-empty line`);
    }
  }
  return errors;
}

/** The contract `frontier` validates: a list of {run, shows}. */
function shapeErrors(itemId, probes) {
  if (probes === undefined || probes === null) return [];
  if (!Array.isArray(probes)) return [`${itemId}: probes must be a list of run and shows pairs`];
  const errors = [];
  probes.forEach((entry, index) => {
    const at = `${itemId}: probes[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must carry a run command and the output it shows`);
      return;
    }
    if (typeof entry.run !== 'string' || entry.run.trim().length === 0) {
      errors.push(`${at}.run must be a non-empty shell command`);
    }
    if (typeof entry.shows !== 'string') {
      errors.push(`${at}.shows must be the output the command prints`);
    }
  });
  return errors;
}

function quote(command) {
  return `'${command.replace(/'/g, "'\\''")}'`;
}

function clip(text) {
  return text.length > MAX_GOT ? `${text.slice(0, MAX_GOT)}...` : text;
}

/**
 * Run one probe in the tree and hand back what it printed, or the code it failed with.
 *
 * A `probes:` measurement is a grep or a count, so it carries its own minute-long cap. A
 * diagnosis probe is whatever shows the cause, a browser run included, so it goes bare through
 * the machine's build wrapper with no cap of its own.
 */
function measure(command, tree, logDir, index, options = {}) {
  const log = path.join(logDir, `probe-${index}.log`);
  const capped = options.cap === false;
  const result = lib.runShell(
    capped ? command : `timeout ${TIMEOUT_SECONDS} bash -c ${quote(command)}`,
    tree,
    log,
    { wrap: capped }
  );
  if (result.code !== 0) return `exit ${result.code}`;
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : '';
}

/** Replay one item's diagnosis probe. Stale evidence is evidence nobody measured on this tree. */
function replayDiagnosis(tree, item) {
  const block = item && item.diagnosis;
  if (!block || typeof block !== 'object' || typeof block.probe !== 'string') return null;
  const command = block.probe.trim();
  const shows = String(block.shows).trim();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-diagnosis-'));
  try {
    const got = measure(command, tree, logDir, 'diagnosis', { cap: false });
    return { command, shows, got: clip(got), ok: got === shows };
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

/** The diagnosis probes of the items about to be dispatched, replayed on the dispatch tree. */
function replayErrors(tree, items) {
  const errors = [];
  for (const item of items) {
    const replay = replayDiagnosis(tree, item);
    if (replay && !replay.ok) {
      errors.push(
        `${item.id}: diagnosis probe ${replay.command} expected ${clip(replay.shows)} got ${replay.got}. ` +
          'Measure the cause again on this tree and plan the fix at what it shows.'
      );
    }
  }
  return errors;
}

/** One item as the measurements see it: its kind and words, its probes and its diagnosis. */
function itemView(tree, itemId, options) {
  const ledger = lib.readLedger(tree);
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === itemId));
  if (!intent) throw new RunError(`work item not found in the live ledger: ${itemId}`, 'ITEM_NOT_FOUND');
  const recorded = intent.items.find((item) => item.id === itemId) || {};
  const spec = lib.readItemSpec(tree, intent.id, itemId);
  return {
    id: itemId,
    intent: intent.id,
    kind: recorded.kind || String(spec.frontmatter.kind || '').toLowerCase(),
    title: spec.frontmatter.title || recorded.title || '',
    description: spec.description,
    diagnosis: spec.manifest.diagnosis,
    probes: spec.manifest.probes,
  };
}

function probes(itemId, options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const item = itemView(tree, itemId, options);
  const declared = item.probes;

  const errors = [...shapeErrors(itemId, declared), ...diagnosisErrors(item)];
  if (errors.length > 0) {
    return { exit: 2, payload: { ok: false, errors }, out: errors.map((error) => `INVALID ${error}`) };
  }

  const results = [];
  const out = [];
  if (Array.isArray(declared) && declared.length > 0) {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-probe-'));
    try {
      declared.forEach((entry, index) => {
        const command = entry.run.trim();
        const shows = String(entry.shows).trim();
        const got = measure(command, tree, logDir, index);
        const ok = got === shows;
        results.push({ run: command, shows, got: clip(got), ok });
        out.push(
          ok
            ? `probe ok ${itemId} ${command}`
            : `drift ${itemId} ${command} expected ${clip(shows)} got ${clip(got)}`
        );
      });
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  }

  const replay = replayDiagnosis(tree, item);
  if (replay) {
    out.push(
      replay.ok
        ? `diagnosis ok ${itemId} ${replay.command}`
        : `drift ${itemId} diagnosis ${replay.command} expected ${clip(replay.shows)} got ${replay.got}`
    );
  }
  if (out.length === 0) out.push(`no probes ${itemId}`);

  const ok = results.every((entry) => entry.ok) && (!replay || replay.ok);
  return { exit: ok ? 0 : 2, payload: { ok, probes: results, diagnosis: replay }, out };
}

module.exports = { diagnosisErrors, isCorrective, probes, replayDiagnosis, replayErrors, shapeErrors };
