#!/usr/bin/env node

const {
  arr,
  findIntent,
  isCompletedIntent,
  readState,
  scanDisk,
  statusCounts,
} = require('./specsmd-fire-utils.cjs');

function usage() {
  return [
    'Usage: node .claude/scripts/specsmd-fire-intents.cjs [--json]',
    '',
    'Lists intents that are not completed, using state.yaml plus disk discovery.',
  ].join('\n');
}

function intentStatus(intent) {
  if (!intent) return 'untracked';
  if (isCompletedIntent(intent)) return 'completed';
  if (intent.status) return intent.status;
  return 'pending';
}

function buildRows(state, disk) {
  const rows = [];
  const seen = new Set();

  for (const intent of arr(state?.intents)) {
    if (!intent?.id) continue;
    seen.add(intent.id);
    const counts = statusCounts(intent.work_items);
    if (isCompletedIntent(intent)) continue;
    rows.push({
      id: intent.id,
      title: intent.title || intent.id,
      status: intentStatus(intent),
      pending: counts.pending,
      in_progress: counts.in_progress,
      blocked: counts.blocked,
      completed: counts.completed,
      total: arr(intent.work_items).length,
      depends_on_intents: arr(intent.depends_on_intents),
      source: 'state',
    });
  }

  for (const intentId of disk.intents) {
    if (seen.has(intentId)) continue;
    const intent = findIntent(state, intentId);
    rows.push({
      id: intentId,
      title: intent?.title || intentId,
      status: 'untracked',
      pending: disk.workItems.get(intentId)?.length || 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      total: disk.workItems.get(intentId)?.length || 0,
      depends_on_intents: [],
      source: 'disk',
    });
  }

  return rows;
}

function renderMarkdown(rows) {
  const lines = ['# Incomplete FIRE intents', ''];
  if (!rows.length) {
    lines.push('- none');
    return lines.join('\n');
  }

  for (const row of rows) {
    const blockedBy = row.depends_on_intents.length ? ` | intent deps=${row.depends_on_intents.join(',')}` : '';
    lines.push(
      `- ${row.id} | ${row.status} | items=${row.completed}/${row.total} done, pending=${row.pending}, in_progress=${row.in_progress}, blocked=${row.blocked}${blockedBy} | ${row.title}`
    );
  }
  return lines.join('\n');
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const state = readState();
  if (!state) {
    console.error('FIRE state not found at .specs-fire/state.yaml');
    process.exit(1);
  }

  const rows = buildRows(state, scanDisk());
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ intents: rows }, null, 2));
    return;
  }

  console.log(renderMarkdown(rows));
}

main();
