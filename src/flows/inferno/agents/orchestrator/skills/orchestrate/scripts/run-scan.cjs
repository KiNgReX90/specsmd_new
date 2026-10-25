'use strict';

/**
 * `run.cjs scan`: four cold scanners each ask one question of the intent's whole diff before
 * the intent review, because some leaks live between items and pass every item review.
 *
 * The call writes one brief per question under the run's cache dir and prints the dispatch
 * lines, grouped by what the host spawns in one message. `--collect` reads the four result
 * files, refuses a line without the command that proves it, and records and commits
 * scan.yaml, bound to the tree the scanners were sent. The intent review answers every line.
 *
 * At plan time, `--only wiring --plan <intent>` asks the wiring question of the plan before
 * anything is built, one scanner per slice of its work items (run-scan-slices.cjs), and its
 * collect merges every slice and hands each gap back to the planner instead of recording.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { hostActor } = require('./run-review.cjs');
const owed = require('./run-intent-owed.cjs');
const { intentReviewCall, scanCall } = require('./run-call.cjs');
const { IDS, QUESTIONS, numbered, readResult, renderScan } = require('./run-scan-file.cjs');
const { planItems, planSlices } = require('./run-scan-slices.cjs');

const { RunError } = lib;

/** The questions the plan-time scan asks: nothing is built yet, so only the wiring can be held. */
const PLAN_IDS = ['wiring'];

/** How many scanners a host spawns in one message: every one on Claude, three on Codex. */
const GROUP = { claude: Infinity, codex: 3 };

const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

/**
 * The questions this call asks, and so the ones its collect reads: all four before the
 * review, wiring alone at plan time. The dispatch records them and the collect reads exactly
 * those, so neither can name a question the other does not. A refused plan-time call prints
 * the caller's own call with wiring alone.
 */
function questions(tree, options) {
  if (!options.plan) {
    if (!options.only) return IDS;
    throw new RunError('usage: --only goes with --plan <intent>; the scan before the review asks all four questions', 'BAD_ARGS', 1);
  }
  const asked = options.only ? String(options.only).split(',').map((id) => id.trim()).filter(Boolean) : PLAN_IDS;
  if (asked.length !== PLAN_IDS.length || asked.some((id) => !PLAN_IDS.includes(id))) {
    const call = scanCall(tree, options.plan, Boolean(options.collect));
    throw new RunError(`usage: the plan-time scan asks wiring alone: run ${call}`, 'BAD_ARGS', 1);
  }
  return PLAN_IDS;
}

/** The agent file the host dispatches the scanner from, relative to the project root. */
function roleFile(config, agent) {
  return config.host === 'codex' ? path.join('.codex', 'agents', `${agent}.toml`) : path.join('.claude', 'agents', `${agent}.md`);
}

/** A host without the scanner role is refused with the fix, never skipped. */
function refuseUninstalled(tree, context) {
  const rel = roleFile(context.config, context.agent);
  if ([tree, lib.primaryRoot(tree)].some((root) => fs.existsSync(path.join(root, rel)))) return;
  throw new RunError(
    `the scanner role is not installed on this host: ${rel} is missing. reinstall the flow on this host so the role lands, ` +
      `then run ${scanCall(tree, context.options.plan)} again.`,
    'NO_SCANNER'
  );
}

const itemPaths = (items) => items.map((id) => `work-items/${id}.md`).join(', ');

/** What the scanner reads: the diff's range, or its slice of the plan and where the rest is. */
function subject(context, entry, entries, range) {
  if (range) return [`- range ${range}`];
  const plan = `${lib.SPECS_DIR}/intents/${context.intent}`;
  const others = entries.filter((other) => other !== entry).flatMap((other) => other.items);
  return [
    `- plan ${plan}: its brief.md and the work items of your slice. Nothing is built yet, so read the plan against the live tree.`,
    `- slice: ${itemPaths(entry.items) || 'none: the plan has no work item yet, so scan its brief.md'}`,
    ...(others.length > 0
      ? [`- other slices, which other scanners cover: ${itemPaths(others)}. Read one only to check a producer or consumer your slice relies on.`]
      : []),
  ];
}

function briefText(tree, context, entry, entries, range) {
  const { question } = entry;
  const scope = range ? 'the range' : 'your slice';
  const of = entries.length > 1 ? `, slice ${entries.indexOf(entry) + 1} of ${entries.length}` : '';
  return [
    `# INFERNO scan: ${question}${of}`,
    '',
    `Answer this one question about intent ${context.intent} and write only the result file. ` +
      `Be exhaustive within ${scope}: ask the question of every identifier, op, field, question id, file contract and ` +
      'behaviour it adds, changes or removes, across the whole tree, and report every gap you find, however many, never a sample. ' +
      'Every line carries the command that proves it.',
    '',
    `- tree ${tree}`,
    ...subject(context, entry, entries, range),
    `- question ${question}: ${QUESTIONS[question]}`,
    `- result ${entry.result}`,
    '',
  ].join('\n');
}

/**
 * What this call dispatches, one entry per scanner: a question each over the diff, or at plan
 * time the wiring question once per slice of the plan's work items.
 */
function entriesFor(context, slices) {
  const at = (id) => ({ brief: path.join(context.dir, `${id}.md`), result: path.join(context.dir, `${id}.yaml`) });
  if (!slices) return context.ids.map((id) => ({ id, question: id, items: null, ...at(id) }));
  const [question] = context.ids;
  return slices.map((items, index) => ({ id: `${question}-${index + 1}`, question, items, ...at(`${question}-${index + 1}`) }));
}

function groupLine(index, size) {
  const what = size === 1 ? 'this one' : `these ${size}`;
  return index === 0 ? `spawn ${what} in one message` : `once they return, spawn ${what} in one message`;
}

function dispatch(tree, context) {
  const { intent, config, options, ids, dir, agent, model } = context;
  refuseUninstalled(tree, context);
  let range = null;
  let slices = null;
  if (options.plan) {
    // A fresh plan-time dispatch drops the last one's briefs and results, whatever its slices were.
    fs.rmSync(dir, { recursive: true, force: true });
    slices = planSlices(tree, intent).map((slice) => slice.items);
    if (slices.length === 0) slices = [[]];
  } else {
    const base = options.base || resolveBase(config, null, tree);
    range = `${short(tree, gate.mergeBase(tree, base))}..${short(tree, 'HEAD')}`;
  }
  fs.mkdirSync(dir, { recursive: true });
  const entries = entriesFor(context, slices);
  for (const entry of entries) {
    fs.rmSync(entry.result, { force: true });
    fs.writeFileSync(entry.brief, briefText(tree, context, entry, entries, range));
  }
  const at = {
    intent, plan: Boolean(options.plan), ids, range, head: lib.git(tree, ['rev-parse', 'HEAD']), hash: proofs.scopeHash(tree),
    slices: entries.map(({ id, question, items }) => ({ id, question, items })),
  };
  fs.writeFileSync(path.join(dir, 'dispatch.json'), `${JSON.stringify(at)}\n`);
  const size = GROUP[config.host === 'codex' ? 'codex' : 'claude'];
  const groups = [];
  for (let i = 0; i < entries.length; i += size) groups.push(entries.slice(i, i + size));
  const out = [`scan of ${intent} ${range ? `over ${range}` : 'of its plan'}`];
  groups.forEach((group, index) => {
    out.push(groupLine(index, group.length));
    for (const entry of group) out.push(`dispatch ${agent}${model ? ` model ${model}` : ''} scan ${entry.question} brief ${entry.brief}`);
  });
  out.push(`then ${scanCall(tree, options.plan, true)} collects them`);
  return { exit: 3, payload: { ok: false, intent, owed: 'scan', agent, model, range, groups }, out };
}

/** The work items added to or dropped from the plan since its slices were dispatched, or null. */
function planChange(tree, intent, entries) {
  const sent = new Set(entries.flatMap((entry) => entry.items || []));
  const now = new Set(planItems(tree, intent).map((item) => item.id));
  const added = [...now].filter((id) => !sent.has(id));
  const dropped = [...sent].filter((id) => !now.has(id));
  if (added.length === 0 && dropped.length === 0) return null;
  return [added.length > 0 ? `added ${added.join(', ')}` : '', dropped.length > 0 ? `dropped ${dropped.join(', ')}` : '']
    .filter(Boolean).join('; ');
}

function readDispatch(dir, intent, plan) {
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, 'dispatch.json'), 'utf8'));
    return entry && entry.intent === intent && entry.plan === plan ? entry : null;
  } catch (error) {
    return null;
  }
}

/** Hand every gap the plan-time scan found back to the planner; nothing is recorded. */
function planGaps(tree, context, results) {
  const lines = numbered(results);
  if (lines.length === 0) {
    return { exit: 0, payload: { ok: true, intent: context.intent, gaps: [] }, out: [`no gap in the plan of ${context.intent}`] };
  }
  return {
    exit: 2,
    payload: { ok: false, intent: context.intent, gaps: lines },
    out: [
      ...lines.map((line) => `GAP ${line.id} ${line.file}:${line.line}: ${line.claim} (proof: ${line.proof})`),
      `resume the planner with every GAP line as one message, then run ${scanCall(tree, context.options.plan)} again`,
    ],
  };
}

function record(tree, context, sent, results) {
  const { intent } = context;
  const rel = owed.scanPath(tree, intent);
  const { text, lines } = renderScan({ intent, range: sent.range, results, tree: sent.hash, commit: sent.head });
  fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
  fs.writeFileSync(path.join(tree, rel), text);
  lib.git(tree, ['add', '--', rel]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent}): scan, ${lines.length} lines`, '--', rel]);
  return {
    exit: 0,
    payload: { ok: true, intent, scan: rel, lines },
    out: [
      `scan of ${intent} collected: ${lines.length} line${lines.length === 1 ? '' : 's'}, recorded in ${rel} at ${short(tree, 'HEAD')}`,
      ...lines.map((line) => `SCAN ${line.id} ${line.file}:${line.line}: ${line.claim}`),
      `then ${intentReviewCall(tree)}`,
    ],
  };
}

function collect(tree, context) {
  const { intent, options, ids, dir } = context;
  const again = scanCall(tree, options.plan);
  const fix = scanCall(tree, options.plan, true);
  const sent = readDispatch(dir, intent, Boolean(options.plan));
  const owing = (out) => ({ exit: 3, payload: { ok: false, intent, owed: 'scan' }, out });
  if (!sent) return owing([`no scan of ${intent} is on record: run ${again}, spawn the dispatch lines it prints, then collect`]);
  if (!options.plan && sent.hash !== proofs.scopeHash(tree)) {
    return owing([
      `the code moved since the scan dispatch at ${sent.head.slice(0, 7)}, so the results read another tree; nothing recorded`,
      `run ${again} for a fresh dispatch, spawn the lines it prints, then collect`,
    ]);
  }
  if (!Array.isArray(sent.ids) || sent.ids.join(',') !== ids.join(',')) {
    return owing([
      `the scan on record asked ${(Array.isArray(sent.ids) && sent.ids.join(', ')) || 'no question'}, and this collect reads ` +
        `${ids.join(', ')}; nothing recorded`,
      `run ${again} for a fresh dispatch, spawn the lines it prints, then collect`,
    ]);
  }
  const entries = Array.isArray(sent.slices) ? sent.slices : ids.map((id) => ({ id, question: id, items: null }));
  const changed = options.plan ? planChange(tree, intent, entries) : null;
  if (changed) {
    return owing([
      `the plan of ${intent} changed since the scan dispatch (${changed}), so a slice went unscanned; nothing collected`,
      `run ${again} for a fresh dispatch, spawn the lines it prints, then collect`,
    ]);
  }
  const resultOf = (entry) => path.join(dir, `${entry.id}.yaml`);
  const missing = entries.filter((entry) => !fs.existsSync(resultOf(entry)));
  if (missing.length > 0) {
    return owing([
      `waiting on the ${missing.map((entry) => entry.id).join(', ')} scanner${missing.length === 1 ? '' : 's'}: ` +
        `${missing.map(resultOf).join(' ')} not written yet`,
      `spawn the dispatch lines ${again} printed for ${missing.length === 1 ? 'it' : 'them'}, then run ${fix} again`,
    ]);
  }
  const results = entries.map((entry) => ({ question: entry.question, lines: readResult(resultOf(entry), entry.question, fix, entry.id) }));
  return options.plan ? planGaps(tree, context, results) : record(tree, context, sent, results);
}

function scan(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const ids = questions(tree, options);
  const intent = options.plan || owed.intentFor(tree, options);
  if (options.plan && !fs.existsSync(path.join(tree, lib.SPECS_DIR, 'intents', intent))) {
    throw new RunError(`no plan of ${intent} in ${path.join(tree, lib.SPECS_DIR, 'intents')}: capture the intent first, then run this again`, 'NO_PLAN');
  }
  const root = path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'scan');
  const dir = options.plan ? path.join(root, `plan-${intent}`) : root;
  const { agent, model } = hostActor('scanner', config);
  const context = { intent, config, options, ids, dir, agent, model };
  if (!options.plan && !owed.scanOwed(tree, intent)) {
    const rel = owed.scanPath(tree, intent);
    return { exit: 0, payload: { ok: true, intent, scan: rel }, out: [`the scan of ${intent} is collected in ${rel}`, `then ${intentReviewCall(tree)}`] };
  }
  return options.collect ? collect(tree, context) : dispatch(tree, context);
}

module.exports = { scan };
