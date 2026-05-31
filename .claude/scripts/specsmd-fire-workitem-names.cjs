#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  arr,
  buildMarkdown,
  findIntent,
  parseFrontmatter,
  readState,
  slugTitle,
  statePath,
  uniqueSlug,
  workItemPath,
  writeState,
} = require('./specsmd-fire-utils.cjs');

function usage() {
  return [
    'Usage:',
    '  node .claude/scripts/specsmd-fire-workitem-names.cjs slug "<title>"',
    '  node .claude/scripts/specsmd-fire-workitem-names.cjs validate <intentId> [--json]',
    '  node .claude/scripts/specsmd-fire-workitem-names.cjs repair <intentId> --prefer-id --dry-run',
    '  node .claude/scripts/specsmd-fire-workitem-names.cjs repair <intentId> --prefer-id --apply',
    '  node .claude/scripts/specsmd-fire-workitem-names.cjs repair <intentId> --prefer-title --dry-run',
    '  node .claude/scripts/specsmd-fire-workitem-names.cjs repair <intentId> --prefer-title --apply',
    '',
    'Policy: the work-item ID is the deterministic slug of the approved title.',
  ].join('\n');
}

function titleFromId(id) {
  return String(id || '')
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (['ai', 'api', 'byok', 'cli', 'cwd', 'html', 'ipc', 'json', 'kb', 'llm', 'mcp', 'md', 'nl', 'pdf', 'pty', 'qa', 'ui', 'ux'].includes(part)) {
        return upper;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function expectedIds(items) {
  const used = new Set();
  const expected = new Map();
  for (const item of items) {
    expected.set(item.id, uniqueSlug(item.title || item.id, used));
  }
  return expected;
}

function validateIntent(root, state, intentId) {
  const intent = findIntent(state, intentId);
  if (!intent) return { ok: false, error: `Intent not found: ${intentId}` };

  const expected = expectedIds(arr(intent.work_items));
  const problems = [];
  const ids = new Set();

  for (const item of arr(intent.work_items)) {
    const expectedId = expected.get(item.id);
    if (ids.has(item.id)) {
      problems.push({ type: 'duplicate-id', id: item.id, title: item.title || item.id });
    }
    ids.add(item.id);

    if (item.id !== expectedId) {
      problems.push({
        type: 'id-title-mismatch',
        id: item.id,
        expected_id: expectedId,
        suggested_title: titleFromId(item.id),
        title: item.title || item.id,
      });
    }

    const file = workItemPath(root, intentId, item.id);
    if (!fs.existsSync(file)) {
      problems.push({ type: 'missing-file', id: item.id, path: path.relative(root, file) });
      continue;
    }

    const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!parsed) {
      problems.push({ type: 'invalid-frontmatter', id: item.id, path: path.relative(root, file) });
      continue;
    }

    if (parsed.frontmatter.id !== item.id) {
      problems.push({ type: 'state-file-id-mismatch', state_id: item.id, file_id: parsed.frontmatter.id });
    }
    if ((parsed.frontmatter.title || '') !== (item.title || '')) {
      problems.push({
        type: 'state-file-title-mismatch',
        id: item.id,
        state_title: item.title || '',
        file_title: parsed.frontmatter.title || '',
      });
    }
  }

  const itemIds = new Set(arr(intent.work_items).map((item) => item.id));
  for (const item of arr(intent.work_items)) {
    for (const dep of arr(item.depends_on)) {
      if (!itemIds.has(dep)) {
        problems.push({ type: 'unknown-dependency', id: item.id, dependency: dep });
      }
    }
  }

  return { ok: problems.length === 0, intent: intentId, problems };
}

function renderValidation(result) {
  if (!result.ok && result.error) return `# Work-item naming validation\n\n- error: ${result.error}`;
  const lines = [`# Work-item naming validation: ${result.intent}`, ''];
  if (!result.problems.length) {
    lines.push('- ok');
  } else {
    for (const problem of result.problems) {
      lines.push(`- ${problem.type}: ${JSON.stringify(problem)}`);
    }
  }
  return lines.join('\n');
}

function buildRepairPlan(state, intentId, strategy) {
  const intent = findIntent(state, intentId);
  if (!intent) return { ok: false, error: `Intent not found: ${intentId}` };
  if (strategy === 'prefer-id') {
    const retitles = arr(intent.work_items)
      .map((item) => ({ id: item.id, from: item.title || '', to: titleFromId(item.id) }))
      .filter((entry) => entry.from !== entry.to);
    return { ok: true, intent, strategy, renames: [], retitles };
  }

  const expected = expectedIds(arr(intent.work_items));
  const renames = arr(intent.work_items)
    .map((item) => ({ from: item.id, to: expected.get(item.id), title: item.title || item.id }))
    .filter((entry) => entry.from !== entry.to);
  return { ok: true, intent, strategy, renames, retitles: [] };
}

function replaceDeps(deps, renameMap) {
  return arr(deps).map((dep) => renameMap.get(dep) || dep);
}

function repairIntent(root, state, intentId, apply, strategy) {
  const plan = buildRepairPlan(state, intentId, strategy);
  if (!plan.ok) return plan;
  const renameMap = new Map(plan.renames.map((entry) => [entry.from, entry.to]));
  if (!apply || (plan.renames.length === 0 && plan.retitles.length === 0)) return { ...plan, applied: false };
  const retitleMap = new Map(plan.retitles.map((entry) => [entry.id, entry.to]));

  for (const item of arr(plan.intent.work_items)) {
    const oldId = item.id;
    const newId = renameMap.get(oldId) || oldId;
    const oldFile = workItemPath(root, intentId, oldId);
    const newFile = workItemPath(root, intentId, newId);

    item.id = newId;
    if (retitleMap.has(oldId)) item.title = retitleMap.get(oldId);
    item.depends_on = replaceDeps(item.depends_on, renameMap);

    if (fs.existsSync(oldFile)) {
      const parsed = parseFrontmatter(fs.readFileSync(oldFile, 'utf8'));
      if (parsed) {
        parsed.frontmatter.id = newId;
        if (retitleMap.has(oldId)) parsed.frontmatter.title = retitleMap.get(oldId);
        parsed.frontmatter.depends_on = replaceDeps(parsed.frontmatter.depends_on, renameMap);
        let body = parsed.body;
        if (retitleMap.has(oldId)) {
          body = body.replace(/^# Work Item: .+$/m, `# Work Item: ${retitleMap.get(oldId)}`);
          body = body.replace(/^\*\*Title\*\*: .+$/m, `**Title**: ${retitleMap.get(oldId)}`);
        }
        fs.writeFileSync(oldFile, buildMarkdown(parsed.frontmatter, body));
      }
      if (oldFile !== newFile) {
        if (fs.existsSync(newFile)) throw new Error(`Refusing to overwrite existing file: ${newFile}`);
        fs.renameSync(oldFile, newFile);
      }
    }
  }

  for (const run of [...arr(state.runs?.active), ...arr(state.runs?.completed)]) {
    for (const runItem of arr(run.work_items)) {
      if (runItem.intent === intentId && renameMap.has(runItem.id)) runItem.id = renameMap.get(runItem.id);
    }
    if (renameMap.has(run.current_item)) run.current_item = renameMap.get(run.current_item);
  }

  writeState(root, state);
  return { ...plan, applied: true, state_path: statePath(root) };
}

function renderRepair(result) {
  if (!result.ok) return `# Work-item naming repair\n\n- error: ${result.error}`;
  const lines = [`# Work-item naming repair: ${result.intent.id}`, '', `- applied: ${result.applied ? 'yes' : 'no'}`];
  lines.push(`- strategy: ${result.strategy || 'prefer-title'}`);
  if (!result.renames.length && !result.retitles.length) {
    lines.push('- renames: none');
  } else {
    for (const rename of result.renames) lines.push(`- ${rename.from} -> ${rename.to} | ${rename.title}`);
    for (const retitle of result.retitles) lines.push(`- retitle ${retitle.id}: "${retitle.from}" -> "${retitle.to}"`);
  }
  return lines.join('\n');
}

function main() {
  const mode = process.argv[2];
  if (!mode || mode === '--help' || mode === '-h') {
    console.log(usage());
    process.exit(mode ? 0 : 1);
  }

  if (mode === 'slug') {
    console.log(slugTitle(process.argv.slice(3).join(' ')));
    return;
  }

  const intentId = process.argv[3];
  if (!intentId) {
    console.log(usage());
    process.exit(1);
  }

  const root = process.cwd();
  const state = readState(root);
  if (!state) {
    console.error('FIRE state not found at .specs-fire/state.yaml');
    process.exit(1);
  }

  if (mode === 'validate') {
    const result = validateIntent(root, state, intentId);
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(renderValidation(result));
    if (!result.ok) process.exitCode = 2;
    return;
  }

  if (mode === 'repair') {
    const apply = process.argv.includes('--apply');
    const strategy = process.argv.includes('--prefer-title') ? 'prefer-title' : 'prefer-id';
    if (!apply && !process.argv.includes('--dry-run')) {
      console.error('Repair requires --dry-run or --apply');
      process.exit(1);
    }
    const result = repairIntent(root, state, intentId, apply, strategy);
    console.log(renderRepair(result));
    return;
  }

  console.log(usage());
  process.exit(1);
}

main();
