#!/usr/bin/env node

const {
  arr,
  findIntent,
  isCompletedIntent,
  readMarkdownFrontmatter,
  readState,
  statusCounts,
  workItemPath,
} = require('./specsmd-fire-utils.cjs');

function readAggregatorFiles(intentId, itemId) {
  try {
    const fm = readMarkdownFrontmatter(workItemPath(process.cwd(), intentId, itemId));
    if (!fm) return [];
    const value = fm.aggregator_files;
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

function usage() {
  return [
    'Usage: node .claude/scripts/specsmd-fire-intent-graph.cjs <intentId> [--json] [--compact] [--include-blocked]',
    '',
    'Prints a dependency-aware execution graph for one FIRE intent.',
    'Use --compact for orchestration loops; it omits completed and blocked item detail.',
    'Add --include-blocked only when no ready/in-progress work can move.',
  ].join('\n');
}

function buildGraph(state, intentId) {
  const intent = findIntent(state, intentId);
  if (!intent) {
    return { ok: false, error: `Intent not found in state: ${intentId}` };
  }

  const intentDeps = arr(intent.depends_on_intents).map((depId) => {
    const dep = findIntent(state, depId);
    return {
      id: depId,
      title: dep?.title || depId,
      status: dep ? (isCompletedIntent(dep) ? 'completed' : dep.status || 'pending') : 'missing',
      completed: isCompletedIntent(dep),
    };
  });
  const intentBlockedBy = intentDeps.filter((dep) => !dep.completed).map((dep) => dep.id);

  const items = arr(intent.work_items);
  const byId = new Map(items.map((item) => [item.id, item]));
  const graphItems = [];
  const ready = [];
  const inProgress = [];
  const completed = [];
  const blocked = [];
  const invalid = [];

  for (const item of items) {
    const deps = arr(item.depends_on);
    const missing = deps.filter((depId) => !byId.has(depId));
    const incomplete = deps.filter((depId) => {
      const dep = byId.get(depId);
      return dep && dep.status !== 'completed';
    });
    const itemBlockedBy = [...intentBlockedBy, ...missing, ...incomplete];
    const entry = {
      id: item.id,
      title: item.title || item.id,
      status: item.status || 'pending',
      mode: item.mode || '?',
      complexity: item.complexity || '?',
      depends_on: deps,
      blocked_by: itemBlockedBy,
      missing_dependencies: missing,
      aggregator_files: readAggregatorFiles(intentId, item.id),
    };

    graphItems.push(entry);

    if (missing.length) invalid.push(entry);
    if (entry.status === 'completed') completed.push(entry);
    else if (entry.status === 'in_progress') inProgress.push(entry);
    else if (entry.status === 'pending' && itemBlockedBy.length === 0) ready.push(entry);
    else blocked.push(entry);
  }

  return {
    ok: true,
    intent: {
      id: intent.id,
      title: intent.title || intent.id,
      status: intent.status || '?',
      depends_on_intents: intentDeps,
      blocked_by_intents: intentBlockedBy,
      counts: statusCounts(items),
    },
    ready,
    in_progress: inProgress,
    blocked,
    completed,
    invalid,
    items: graphItems,
  };
}

function renderMarkdown(graph) {
  if (!graph.ok) return `# Intent graph\n\n- error: ${graph.error}`;
  const lines = [`# Intent graph: ${graph.intent.id}`, ''];
  lines.push(`- title: ${graph.intent.title}`);
  lines.push(`- status: ${graph.intent.status}`);
  lines.push(`- counts: pending=${graph.intent.counts.pending}, in_progress=${graph.intent.counts.in_progress}, completed=${graph.intent.counts.completed}, blocked=${graph.intent.counts.blocked}`);
  lines.push(`- blocked by intents: ${graph.intent.blocked_by_intents.length ? graph.intent.blocked_by_intents.join(', ') : 'none'}`);
  lines.push('');

  const section = (title, rows, render) => {
    lines.push(`## ${title}`);
    if (!rows.length) lines.push('- none');
    else rows.forEach((row) => lines.push(`- ${render(row)}`));
    lines.push('');
  };

  section('Ready now', graph.ready, (item) => `${item.id} | ${item.mode}/${item.complexity} | ${item.title}`);
  section('In progress', graph.in_progress, (item) => `${item.id} | ${item.mode}/${item.complexity} | ${item.title}`);
  section('Blocked', graph.blocked, (item) => `${item.id} | blocked_by=${item.blocked_by.join(', ')} | ${item.title}`);
  section('Invalid dependencies', graph.invalid, (item) => `${item.id} | missing=${item.missing_dependencies.join(', ')} | ${item.title}`);
  section('Completed', graph.completed, (item) => `${item.id} | ${item.title}`);
  lines.push('Parallelism note: launch ready items in parallel only after checking likely file ownership does not overlap.');
  return lines.join('\n');
}

function compactItems(rows) {
  return rows.map((item) => ({
    id: item.id,
    status: item.status,
    mode: item.mode,
    complexity: item.complexity,
    depends_on: item.depends_on,
    blocked_by: item.blocked_by,
    aggregator_files: item.aggregator_files || [],
    title: item.title,
  }));
}

function buildCompactGraph(graph, options = {}) {
  if (!graph.ok) return graph;
  const compact = {
    ok: true,
    intent: {
      id: graph.intent.id,
      title: graph.intent.title,
      status: graph.intent.status,
      blocked_by_intents: graph.intent.blocked_by_intents,
      counts: graph.intent.counts,
    },
    ready: compactItems(graph.ready),
    in_progress: compactItems(graph.in_progress),
    blocked_count: graph.blocked.length,
    invalid: compactItems(graph.invalid),
    completed_count: graph.completed.length,
  };
  if (options.includeBlocked) compact.blocked = compactItems(graph.blocked);
  return compact;
}

function renderCompactMarkdown(graph, options = {}) {
  const compact = buildCompactGraph(graph, options);
  if (!compact.ok) return `# Intent graph compact\n\n- error: ${compact.error}`;

  const lines = [`# Intent graph compact: ${compact.intent.id}`, ''];
  lines.push(`- status: ${compact.intent.status}`);
  lines.push(`- counts: pending=${compact.intent.counts.pending}, in_progress=${compact.intent.counts.in_progress}, completed=${compact.intent.counts.completed}, blocked=${compact.intent.counts.blocked}`);
  lines.push(`- blocked by intents: ${compact.intent.blocked_by_intents.length ? compact.intent.blocked_by_intents.join(', ') : 'none'}`);
  lines.push(`- completed count: ${compact.completed_count}`);
  lines.push(`- blocked count: ${compact.blocked_count}`);
  lines.push('');

  const section = (title, rows, render) => {
    lines.push(`## ${title}`);
    if (!rows.length) lines.push('- none');
    else rows.forEach((row) => lines.push(`- ${render(row)}`));
    lines.push('');
  };

  section('Ready now', compact.ready, (item) => `${item.id} | ${item.mode}/${item.complexity} | ${item.title}`);
  section('In progress', compact.in_progress, (item) => `${item.id} | ${item.mode}/${item.complexity} | ${item.title}`);
  section('Invalid dependencies', compact.invalid, (item) => `${item.id} | blocked_by=${item.blocked_by.join(', ') || 'none'} | ${item.title}`);
  if (options.includeBlocked) {
    section('Blocked', compact.blocked, (item) => `${item.id} | blocked_by=${item.blocked_by.join(', ') || 'none'} | ${item.title}`);
  } else if (compact.blocked_count > 0) {
    lines.push('Blocked item detail omitted. Rerun with `--include-blocked` only when no ready/in-progress item can move.');
  }
  lines.push('Do not expand completed or blocked items unless debugging a state inconsistency or unblocking stalled scheduling.');
  return lines.join('\n');
}

function main() {
  const intentId = process.argv[2];
  if (!intentId || intentId === '--help' || intentId === '-h') {
    console.log(usage());
    process.exit(intentId ? 0 : 1);
  }

  const state = readState();
  if (!state) {
    console.error('FIRE state not found at .specs-fire/state.yaml');
    process.exit(1);
  }

  const graph = buildGraph(state, intentId);
  const compact = process.argv.includes('--compact');
  const includeBlocked = process.argv.includes('--include-blocked');
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(compact ? buildCompactGraph(graph, { includeBlocked }) : graph, null, 2));
  } else {
    console.log(compact ? renderCompactMarkdown(graph, { includeBlocked }) : renderMarkdown(graph));
  }
  if (!graph.ok || graph.invalid?.length) process.exitCode = 2;
}

main();
