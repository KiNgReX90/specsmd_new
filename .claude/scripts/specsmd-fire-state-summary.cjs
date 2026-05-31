#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = process.cwd();
const statePath = path.join(root, '.specs-fire', 'state.yaml');
const archivePath = path.join(root, '.specs-fire', 'state-archive.yaml');
const intentsDir = path.join(root, '.specs-fire', 'intents');

function readState() {
  if (!fs.existsSync(statePath)) return null;
  return YAML.parse(fs.readFileSync(statePath, 'utf8'));
}

function readArchive() {
  if (!fs.existsSync(archivePath)) return null;
  return YAML.parse(fs.readFileSync(archivePath, 'utf8'));
}

// Merge live + archive for read paths that need historical context. Live always wins
// for any intent id collision (e.g. an intent stub vs. its archived body — we prefer
// the archived body so callers see full work_items). Active runs come from live;
// completed runs come from archive.
function mergedState(live) {
  const archive = readArchive();
  if (!archive) return live;
  const liveIntents = Array.isArray(live?.intents) ? live.intents : [];
  const archIntents = Array.isArray(archive?.intents) ? archive.intents : [];
  const archById = new Map(archIntents.map((i) => [i.id, i]));
  const merged = liveIntents.map((i) =>
    i?.archived && archById.has(i.id) ? archById.get(i.id) : i,
  );
  return {
    ...live,
    intents: merged,
    runs: {
      active: Array.isArray(live?.runs?.active) ? live.runs.active : [],
      completed: Array.isArray(archive?.runs?.completed) ? archive.runs.completed : [],
    },
  };
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function scanDisk() {
  const result = { intentCount: 0, workItemCount: 0, untrackedIntents: [], untrackedWorkItems: [] };
  if (!fs.existsSync(intentsDir)) return result;

  const intentDirs = fs.readdirSync(intentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  result.intentCount = intentDirs.length;

  for (const dirent of intentDirs) {
    const intentId = dirent.name;
    const workItemsPath = path.join(intentsDir, intentId, 'work-items');
    const items = fs.existsSync(workItemsPath)
      ? fs
          .readdirSync(workItemsPath, { withFileTypes: true })
          .filter((d) => d.isFile() && d.name.endsWith('.md') && !d.name.endsWith('-design.md'))
          .map((d) => d.name.replace(/\.md$/, ''))
      : [];
    result.workItemCount += items.length;
    result[`items:${intentId}`] = items;
  }

  return result;
}

function flattenTracked(state) {
  const trackedIntentIds = new Set();
  const trackedItems = new Set();

  for (const intent of arr(state?.intents)) {
    if (intent?.id) trackedIntentIds.add(intent.id);
    for (const item of arr(intent?.work_items)) {
      if (intent?.id && item?.id) trackedItems.add(`${intent.id}/${item.id}`);
    }
  }

  return { trackedIntentIds, trackedItems };
}

function statusCounts(state) {
  const counts = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
  for (const intent of arr(state?.intents)) {
    for (const item of arr(intent?.work_items)) {
      if (item?.status && counts[item.status] !== undefined) counts[item.status] += 1;
    }
  }
  return counts;
}

function topPending(state, limit = 8) {
  const items = [];
  for (const intent of arr(state?.intents)) {
    for (const item of arr(intent?.work_items)) {
      if (item?.status === 'pending') {
        items.push({
          intent: intent.id,
          id: item.id,
          title: item.title || item.id,
          mode: item.mode || '?',
          complexity: item.complexity || '?',
        });
      }
    }
  }
  return items.slice(0, limit);
}

function activeIntent(state) {
  return arr(state?.intents).find((intent) => intent.status === 'in_progress') || null;
}

function findIntent(state, intentId) {
  return arr(state?.intents).find((entry) => entry.id === intentId) || null;
}

function findStateItem(state, intentId, itemId) {
  const intent = findIntent(state, intentId);
  if (!intent) return null;
  return arr(intent.work_items).find((entry) => entry.id === itemId) || null;
}

function currentBuilder(state) {
  const run = arr(state?.runs?.active)[0] || null;
  if (!run) return { run: null, item: null, stateItem: null };
  const item = arr(run.work_items).find((entry) => entry.id === run.current_item) || null;
  const stateItem = item ? findStateItem(state, item.intent, item.id) : null;
  return { run, item, stateItem };
}

function bulletList(items, render) {
  if (!items.length) return '- none';
  return items.map((item) => `- ${render(item)}`).join('\n');
}

function resolveUntracked(state, disk) {
  const { trackedIntentIds, trackedItems } = flattenTracked(state);
  for (const key of Object.keys(disk).filter((entry) => entry.startsWith('items:'))) {
    const intentId = key.slice(6);
    if (!trackedIntentIds.has(intentId)) disk.untrackedIntents.push(intentId);
    for (const itemId of disk[key]) {
      if (!trackedItems.has(`${intentId}/${itemId}`)) disk.untrackedWorkItems.push(`${intentId}/${itemId}`);
    }
  }
}

function printHeader(state, disk, lines, mode) {
  const counts = statusCounts(state);
  const intents = arr(state?.intents);
  const activeRun = arr(state?.runs?.active)[0] || null;

  lines.push(`# FIRE ${mode} summary`);
  lines.push('');
  lines.push(`- project: ${state?.project?.name || 'unknown'}`);
  lines.push(`- workspace: ${state?.workspace?.type || '?'} / ${state?.workspace?.structure || '?'}`);
  lines.push(`- autonomy: ${state?.workspace?.autonomy_bias || '?'}`);
  lines.push(`- intents in state: ${intents.length}`);
  lines.push(`- intents on disk: ${disk.intentCount}`);
  lines.push(`- work items on disk: ${disk.workItemCount}`);
  lines.push(`- work item status counts: pending=${counts.pending}, in_progress=${counts.in_progress}, completed=${counts.completed}, blocked=${counts.blocked}`);
  lines.push(`- active run: ${activeRun ? activeRun.id : 'none'}`);
  lines.push(`- untracked intents on disk: ${disk.untrackedIntents.length}`);
  lines.push(`- untracked work items on disk: ${disk.untrackedWorkItems.length}`);
  lines.push('');
}

function runRoute(state, disk) {
  const lines = [];
  printHeader(state, disk, lines, 'route');
  const counts = statusCounts(state);
  const activeRun = arr(state?.runs?.active)[0] || null;
  const active = activeIntent(state);
  lines.push('## Routing facts');
  lines.push(`- active run present: ${activeRun ? 'yes' : 'no'}`);
  lines.push(`- pending work items: ${counts.pending}`);
  lines.push(`- active intent without work items: ${active && arr(active.work_items).length === 0 ? 'yes' : 'no'}`);
  lines.push(`- active intent: ${active ? `${active.id} (${active.title || active.id})` : 'none'}`);
  lines.push('');
  lines.push('## Pending work items');
  lines.push(bulletList(topPending(state), (item) => `${item.intent}/${item.id} | ${item.mode} | ${item.complexity} | ${item.title}`));
  lines.push('');
  lines.push('## Deeper views (on demand)');
  lines.push('- `state-summary.cjs active-run` — full active run breakdown');
  lines.push('- `state-summary.cjs intent <intentId>` — one intent');
  lines.push('- `state-summary.cjs item <intentId>/<itemId>` — one work item');
  lines.push('- `state-summary.cjs runs [N]` — active + last N completed runs');
  return lines.join('\n');
}

function runPlanner(state, disk) {
  const lines = [];
  printHeader(state, disk, lines, 'planner');
  const active = activeIntent(state);
  lines.push('## Active intent');
  lines.push(active ? `- ${active.id} | ${active.title || active.id} | status=${active.status} | work_items=${arr(active.work_items).length}` : '- none');
  lines.push('');
  lines.push('## Pending work items');
  lines.push(bulletList(topPending(state), (item) => `${item.intent}/${item.id} | ${item.mode} | ${item.title}`));
  lines.push('');
  lines.push('## Deeper views (on demand)');
  lines.push('- `state-summary.cjs intent <intentId>` — full intent + its items');
  lines.push('- `state-summary.cjs item <intentId>/<itemId>` — one work item');
  return lines.join('\n');
}

function runBuilder(state, disk) {
  const lines = [];
  printHeader(state, disk, lines, 'builder');
  const builder = currentBuilder(state);
  lines.push('## Current run');
  if (builder.run) {
    const items = arr(builder.run.work_items);
    const byStatus = items.reduce((acc, it) => {
      acc[it.status || 'unknown'] = (acc[it.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const statusStr = Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`- run=${builder.run.id} | scope=${builder.run.scope || '?'} | status=${builder.run.status || '?'} | current_item=${builder.run.current_item || 'none'} | items: ${statusStr}`);
  } else {
    lines.push('- none');
  }
  lines.push('');
  lines.push('## Current item');
  if (builder.item) {
    lines.push(`- run item: ${builder.item.intent}/${builder.item.id} | mode=${builder.item.mode || '?'} | status=${builder.item.status || '?'} | phase=${builder.item.current_phase || '?'} | checkpoint=${builder.item.checkpoint_state || '?'}`);
    if (builder.stateItem) {
      lines.push(`- state item: ${builder.stateItem.title || builder.stateItem.id} | status=${builder.stateItem.status || '?'} | complexity=${builder.stateItem.complexity || '?'} | mode=${builder.stateItem.mode || '?'}`);
    }
  } else {
    lines.push('- none');
  }
  lines.push('');
  lines.push('## Next pending items');
  lines.push(bulletList(topPending(state), (item) => `${item.intent}/${item.id} | ${item.mode} | ${item.title}`));
  lines.push('');
  lines.push('## Deeper views (on demand)');
  lines.push('- `state-summary.cjs active-run` — full work-item breakdown for the active run');
  lines.push('- `state-summary.cjs item <intentId>/<itemId>` — one work item');
  lines.push('- `state-summary.cjs runs [N]` — active + last N completed runs');
  return lines.join('\n');
}

function runActiveRun(state) {
  const lines = [];
  const run = arr(state?.runs?.active)[0] || null;
  if (!run) {
    lines.push('# Active run');
    lines.push('');
    lines.push('- none');
    return lines.join('\n');
  }
  lines.push(`# Active run: ${run.id}`);
  lines.push('');
  lines.push(`- scope: ${run.scope || '?'}`);
  lines.push(`- status: ${run.status || '?'}`);
  lines.push(`- started: ${run.started || '?'}`);
  lines.push(`- current_item: ${run.current_item || 'none'}`);
  lines.push('');
  lines.push('## Work items');
  const items = arr(run.work_items);
  if (!items.length) {
    lines.push('- none');
  } else {
    for (const it of items) {
      const parts = [
        `${it.intent || '?'}/${it.id}`,
        `mode=${it.mode || '?'}`,
        `status=${it.status || '?'}`,
        `phase=${it.current_phase || '?'}`,
        `checkpoint=${it.checkpoint_state || '?'}${it.current_checkpoint ? ` (${it.current_checkpoint})` : ''}`,
      ];
      if (it.completed_at) parts.push(`completed_at=${it.completed_at}`);
      lines.push(`- ${parts.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

function runIntent(state, intentId) {
  const lines = [];
  const intent = findIntent(state, intentId);
  if (!intent) {
    lines.push(`# Intent: ${intentId}`);
    lines.push('- not found in state');
    return lines.join('\n');
  }
  lines.push(`# Intent: ${intent.id}`);
  lines.push('');
  lines.push(`- title: ${intent.title || intent.id}`);
  lines.push(`- status: ${intent.status || '?'}`);
  if (Array.isArray(intent.depends_on_intents) && intent.depends_on_intents.length) {
    lines.push(`- depends_on_intents: ${intent.depends_on_intents.join(', ')}`);
  }
  lines.push('');
  lines.push('## Work items');
  const items = arr(intent.work_items);
  if (!items.length) {
    lines.push('- none');
  } else {
    for (const it of items) {
      const parts = [
        it.id,
        it.status || '?',
        `${it.complexity || '?'}/${it.mode || '?'}`,
      ];
      if (Array.isArray(it.depends_on) && it.depends_on.length) parts.push(`deps=${it.depends_on.join(',')}`);
      if (it.run_id) parts.push(`run=${it.run_id}`);
      if (it.completed_at) parts.push(`completed_at=${it.completed_at}`);
      parts.push(it.title || it.id);
      lines.push(`- ${parts.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

function runItem(state, ref) {
  const lines = [];
  const [intentId, itemId] = (ref || '').split('/');
  if (!intentId || !itemId) {
    lines.push('# Item');
    lines.push('- usage: item <intentId>/<itemId>');
    return lines.join('\n');
  }
  const item = findStateItem(state, intentId, itemId);
  if (!item) {
    lines.push(`# Item: ${intentId}/${itemId}`);
    lines.push('- not found in state');
    return lines.join('\n');
  }
  lines.push(`# Item: ${intentId}/${item.id}`);
  lines.push('');
  for (const [k, v] of Object.entries(item)) {
    lines.push(`- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }
  return lines.join('\n');
}

function runRuns(state, limitArg) {
  const lines = [];
  const limit = Math.max(1, Math.min(parseInt(limitArg, 10) || 5, 20));
  const active = arr(state?.runs?.active);
  const completed = arr(state?.runs?.completed);
  lines.push(`# Runs (active + last ${limit} completed)`);
  lines.push('');
  lines.push('## Active');
  if (!active.length) {
    lines.push('- none');
  } else {
    for (const r of active) {
      lines.push(`- ${r.id} | scope=${r.scope || '?'} | status=${r.status || '?'} | items=${arr(r.work_items).length} | current=${r.current_item || 'none'}`);
    }
  }
  lines.push('');
  lines.push('## Completed (most recent first)');
  const tail = completed.slice(-limit).reverse();
  if (!tail.length) {
    lines.push('- none');
  } else {
    for (const r of tail) {
      lines.push(`- ${r.id} | scope=${r.scope || '?'} | items=${arr(r.work_items).length} | started=${r.started || '?'} | completed=${r.completed || '?'}`);
    }
  }
  return lines.join('\n');
}

function printUsage() {
  return [
    '# FIRE state summary — usage',
    '',
    'node .claude/scripts/specsmd-fire-state-summary.cjs <mode> [arg]',
    '',
    'Modes:',
    '  route                     Orchestrator header + routing facts + top pending',
    '  planner                   Planner header + active intent + top pending',
    '  builder                   Builder header + current run/item summary',
    '  active-run                Full work-item breakdown for the active run',
    '  intent <intentId>         One intent + its work items',
    '  item <intentId>/<itemId>  One work item',
    '  runs [N]                  Active + last N completed runs (default 5, max 20)',
    '',
    'Use these slices instead of reading .specs-fire/state.yaml directly.',
  ].join('\n');
}

function main() {
  const mode = process.argv[2] || 'route';

  if (mode === 'help' || mode === '--help' || mode === '-h') {
    console.log(printUsage());
    return;
  }

  const liveState = readState();
  if (!liveState) {
    console.log('FIRE state: not initialized');
    return;
  }
  const fullState = mergedState(liveState);

  const disk = scanDisk();
  resolveUntracked(fullState, disk);

  let output;
  switch (mode) {
    case 'route':
      output = runRoute(fullState, disk);
      break;
    case 'planner':
      output = runPlanner(fullState, disk);
      break;
    case 'builder':
      output = runBuilder(fullState, disk);
      break;
    case 'active-run':
      output = runActiveRun(fullState);
      break;
    case 'intent':
      output = runIntent(fullState, process.argv[3]);
      break;
    case 'item':
      output = runItem(fullState, process.argv[3]);
      break;
    case 'runs':
      output = runRuns(fullState, process.argv[3]);
      break;
    default:
      output = printUsage();
  }

  console.log(output);
}

main();
