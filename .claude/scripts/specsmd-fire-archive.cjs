#!/usr/bin/env node
// One-shot tool: split .specs-fire/state.yaml into live state.yaml + state-archive.yaml.
//
// Live keeps:    project, workspace, intents (full list — pending + in_progress only have
//                their full block; completed intents kept as a stub: {id, title, status,
//                completed_at, archived: true}), runs.active.
// Archive keeps: completed intents (full block including work_items) + runs.completed.
//
// Re-running is safe: it merges existing archive contents and re-derives the split.

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = process.cwd();
const livePath = path.join(root, '.specs-fire', 'state.yaml');
const archivePath = path.join(root, '.specs-fire', 'state-archive.yaml');

function readYaml(p) {
  if (!fs.existsSync(p)) return null;
  return YAML.parse(fs.readFileSync(p, 'utf8'));
}

function writeYaml(p, data) {
  const out = YAML.stringify(data, { lineWidth: 0, indent: 2 });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, p);
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function intentStub(intent) {
  const stub = {
    id: intent.id,
    title: intent.title || intent.id,
    status: 'completed',
    archived: true,
  };
  if (intent.completed_at) stub.completed_at = intent.completed_at;
  if (Array.isArray(intent.depends_on_intents) && intent.depends_on_intents.length) {
    stub.depends_on_intents = intent.depends_on_intents;
  }
  return stub;
}

function dedupeById(items) {
  const seen = new Map();
  for (const it of items) {
    if (!it || !it.id) continue;
    seen.set(it.id, it);
  }
  return [...seen.values()];
}

function main() {
  const live = readYaml(livePath);
  if (!live) {
    console.error('No state.yaml found.');
    process.exit(1);
  }
  const existingArchive = readYaml(archivePath) || { intents: [], runs: { completed: [] } };

  const intents = arr(live.intents);

  // Auto-flip: any pending/in_progress intent whose work_items are all completed
  // (and there is at least one work item) is implicitly done. Flip to completed and
  // stamp completed_at from max(work_items.completed_at).
  let autoFlipped = 0;
  for (const intent of intents) {
    if (intent?.status === 'completed') continue;
    if (intent?.archived) continue;
    const items = arr(intent?.work_items);
    if (items.length === 0) continue;
    const allDone = items.every((w) => w?.status === 'completed');
    if (!allDone) continue;
    intent.status = 'completed';
    if (!intent.completed_at) {
      const stamps = items.map((w) => w?.completed_at).filter(Boolean).sort();
      if (stamps.length) intent.completed_at = stamps[stamps.length - 1];
    }
    autoFlipped += 1;
  }

  const completedIntents = intents.filter((i) => i?.status === 'completed' && !i?.archived);
  const remainingIntents = intents.filter((i) => i?.status !== 'completed');
  const alreadyStubbed = intents.filter((i) => i?.status === 'completed' && i?.archived);

  // New live intents list: keep all non-completed intents in full + stubs for completed.
  const newLiveIntents = [
    ...remainingIntents,
    ...alreadyStubbed,
    ...completedIntents.map(intentStub),
  ];

  // Archive grows: existing archive + newly-completed intents (full bodies).
  const newArchiveIntents = dedupeById([
    ...arr(existingArchive.intents),
    ...completedIntents,
  ]);

  // Runs: live keeps active only; archive collects completed.
  const liveRuns = { active: arr(live.runs?.active) };
  const newArchiveRuns = {
    completed: dedupeById([
      ...arr(existingArchive.runs?.completed),
      ...arr(live.runs?.completed),
    ]),
  };

  const newLive = {
    project: live.project,
    workspace: live.workspace,
    intents: newLiveIntents,
    runs: liveRuns,
  };

  const newArchive = {
    note: 'Auto-managed by .claude/scripts/specsmd-fire-archive.cjs. Holds full bodies of completed intents and completed runs. Live state.yaml keeps stubs for archived intents.',
    intents: newArchiveIntents,
    runs: newArchiveRuns,
  };

  writeYaml(livePath, newLive);
  writeYaml(archivePath, newArchive);

  const liveLines = fs.readFileSync(livePath, 'utf8').split('\n').length;
  const archLines = fs.readFileSync(archivePath, 'utf8').split('\n').length;
  console.log(`Auto-flipped ${autoFlipped} intent(s) from pending → completed (all work items done).`);
  console.log(`Archived ${completedIntents.length} newly-completed intents and ${arr(live.runs?.completed).length} completed runs.`);
  console.log(`Live state.yaml: ${liveLines} lines.`);
  console.log(`Archive state-archive.yaml: ${archLines} lines.`);
  console.log(`Total intents (live + archive): ${newLiveIntents.length} (${alreadyStubbed.length + completedIntents.length} stubs/completed).`);
}

main();
