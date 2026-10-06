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
 * anything is built, and its collect hands each gap back to the planner instead of recording.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { hostActor } = require('./run-review.cjs');
const owed = require('./run-intent-owed.cjs');
const { IDS, QUESTIONS, numbered, readResult, renderScan } = require('./run-scan-file.cjs');

const { RunError } = lib;

/** The questions the plan-time scan asks: nothing is built yet, so only the wiring can be held. */
const PLAN_IDS = ['wiring'];

/** How many scanners a host spawns in one message. */
const GROUP = { claude: 4, codex: 3 };

const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

/**
 * The questions this call asks, and so the ones its collect reads: all four before the
 * review, wiring alone at plan time. The dispatch records them and the collect reads exactly
 * those, so neither can name a question the other does not.
 */
function questions(options) {
  if (!options.plan) {
    if (!options.only) return IDS;
    throw new RunError('usage: --only goes with --plan <intent>; the scan before the review asks all four questions', 'BAD_ARGS', 1);
  }
  const asked = options.only ? String(options.only).split(',').map((id) => id.trim()).filter(Boolean) : PLAN_IDS;
  if (asked.length !== PLAN_IDS.length || asked.some((id) => !PLAN_IDS.includes(id))) {
    throw new RunError(`usage: the plan-time scan asks wiring alone: run run.cjs scan --only wiring --plan ${options.plan}`, 'BAD_ARGS', 1);
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
      `then run ${owed.scanCommand(tree, context.options)} again.`,
    'NO_SCANNER'
  );
}

function briefText(tree, context, id, entry, range) {
  const subject = range
    ? `- range ${range}`
    : `- plan ${lib.SPECS_DIR}/intents/${context.intent}: its brief.md and work-items/. Nothing is built yet, ` +
      'so read the plan against the live tree.';
  return [
    `# INFERNO scan: ${id}`,
    '',
    `Answer this one question about intent ${context.intent} and write only the result file. ` +
      'Every line carries the command that proves it.',
    '',
    `- tree ${tree}`,
    subject,
    `- question ${id}: ${QUESTIONS[id]}`,
    `- result ${entry.result}`,
    '',
  ].join('\n');
}

function groupLine(index, size) {
  const what = size === 1 ? 'this one' : `these ${size}`;
  return index === 0 ? `spawn ${what} in one message` : `once they return, spawn ${what} in one message`;
}

function dispatch(tree, context) {
  const { intent, config, options, ids, dir, agent, model } = context;
  refuseUninstalled(tree, context);
  let range = null;
  if (!options.plan) {
    const base = options.base || resolveBase(config, null, tree);
    range = `${short(tree, gate.mergeBase(tree, base))}..${short(tree, 'HEAD')}`;
  }
  fs.mkdirSync(dir, { recursive: true });
  const entries = ids.map((id) => ({ id, brief: path.join(dir, `${id}.md`), result: path.join(dir, `${id}.yaml`) }));
  for (const entry of entries) {
    fs.rmSync(entry.result, { force: true });
    fs.writeFileSync(entry.brief, briefText(tree, context, entry.id, entry, range));
  }
  const at = { intent, plan: Boolean(options.plan), ids, range, head: lib.git(tree, ['rev-parse', 'HEAD']), hash: proofs.scopeHash(tree) };
  fs.writeFileSync(path.join(dir, 'dispatch.json'), `${JSON.stringify(at)}\n`);
  const size = GROUP[config.host === 'codex' ? 'codex' : 'claude'];
  const groups = [];
  for (let i = 0; i < entries.length; i += size) groups.push(entries.slice(i, i + size));
  const out = [`scan of ${intent} ${range ? `over ${range}` : 'of its plan'}`];
  groups.forEach((group, index) => {
    out.push(groupLine(index, group.length));
    for (const entry of group) out.push(`dispatch ${agent}${model ? ` model ${model}` : ''} scan ${entry.id} brief ${entry.brief}`);
  });
  out.push(`then ${owed.scanCommand(tree, options, true)} collects them`);
  return { exit: 3, payload: { ok: false, intent, owed: 'scan', agent, model, range, groups }, out };
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
      `resume the planner with every GAP line as one message, then run ${owed.scanCommand(tree, context.options)} again`,
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
      `then ${owed.reviewCommand(tree, context.options)}`,
    ],
  };
}

function collect(tree, context) {
  const { intent, options, ids, dir } = context;
  const again = owed.scanCommand(tree, options);
  const fix = owed.scanCommand(tree, options, true);
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
  const missing = ids.filter((id) => !fs.existsSync(path.join(dir, `${id}.yaml`)));
  if (missing.length > 0) {
    return owing([
      `waiting on the ${missing.join(', ')} scanner${missing.length === 1 ? '' : 's'}: ` +
        `${missing.map((id) => path.join(dir, `${id}.yaml`)).join(' ')} not written yet`,
      `spawn the dispatch lines ${again} printed for ${missing.length === 1 ? 'it' : 'them'}, then run ${fix} again`,
    ]);
  }
  const results = Object.fromEntries(ids.map((id) => [id, readResult(path.join(dir, `${id}.yaml`), id, fix)]));
  return options.plan ? planGaps(tree, context, results) : record(tree, context, sent, results);
}

function scan(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const ids = questions(options);
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
    return { exit: 0, payload: { ok: true, intent, scan: rel }, out: [`the scan of ${intent} is collected in ${rel}`, `then ${owed.reviewCommand(tree, options)}`] };
  }
  return options.collect ? collect(tree, context) : dispatch(tree, context);
}

module.exports = { scan };
