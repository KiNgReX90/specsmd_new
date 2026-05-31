#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  execGit,
  safeBranchToken,
  statePath,
} = require('./specsmd-fire-utils.cjs');

function usage() {
  return [
    'Usage:',
    '  node .claude/scripts/specsmd-fire-intent-worktree.cjs <intentId> create',
    '  node .claude/scripts/specsmd-fire-intent-worktree.cjs <intentId> ensure',
    '  node .claude/scripts/specsmd-fire-intent-worktree.cjs <intentId> merge',
    '  node .claude/scripts/specsmd-fire-intent-worktree.cjs <intentId> cleanup',
    '  node .claude/scripts/specsmd-fire-intent-worktree.cjs <intentId> subworktree-create <workItemId>',
    '  node .claude/scripts/specsmd-fire-intent-worktree.cjs <intentId> subworktree-merge <workItemId>',
    '',
    'Creates one git worktree per intent and merges it back to the parent branch.',
    'Use ensure from launchers/orchestrators so interrupted intent sessions resume the existing worktree.',
    'Creation copies Claude local permission settings from the parent checkout into the new worktree.',
  ].join('\n');
}

function metaPath(root, intentId) {
  return path.join(root, '.claude', 'worktrees', `fire-intent-${safeBranchToken(intentId)}.meta.json`);
}

function worktreePath(root, intentId) {
  return path.join(root, '.claude', 'worktrees', `fire-intent-${safeBranchToken(intentId)}`);
}

function readMeta(root, intentId) {
  const file = metaPath(root, intentId);
  if (!fs.existsSync(file)) throw new Error(`No worktree metadata found: ${path.relative(root, file)}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeMeta(root, intentId, meta) {
  const dir = path.dirname(metaPath(root, intentId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(root, intentId), `${JSON.stringify(meta, null, 2)}\n`);
}

function currentBranch(root) {
  return execGit(['branch', '--show-current'], { cwd: root }) || execGit(['rev-parse', '--short', 'HEAD'], { cwd: root });
}

function gitSucceeds(args, options = {}) {
  try {
    execGit(args, options);
    return true;
  } catch {
    return false;
  }
}

function inheritClaudePermissions(root, target) {
  const source = path.join(root, '.claude', 'settings.local.json');
  const destination = path.join(target, '.claude', 'settings.local.json');
  if (!fs.existsSync(source)) {
    return {
      inherited: false,
      reason: 'No parent .claude/settings.local.json found.',
    };
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return {
    inherited: true,
    source: path.relative(root, source),
    destination: path.relative(target, destination),
  };
}

function decorateMeta(root, meta, action) {
  const exists = fs.existsSync(meta.path);
  const result = {
    ...meta,
    action,
    exists,
  };

  if (!exists) return result;

  result.branch_current = currentBranch(meta.path);
  result.head_sha = execGit(['rev-parse', 'HEAD'], { cwd: meta.path });
  result.dirty = execGit(['status', '--short'], { cwd: meta.path });
  return result;
}

function create(root, intentId) {
  const target = worktreePath(root, intentId);
  const metaFile = metaPath(root, intentId);
  if (fs.existsSync(target) || fs.existsSync(metaFile)) {
    throw new Error(`Intent worktree already exists for ${intentId}: ${path.relative(root, target)}`);
  }

  const parentBranch = currentBranch(root);
  const baseSha = execGit(['rev-parse', 'HEAD'], { cwd: root });
  const branch = `fire-intent/${safeBranchToken(intentId)}-${Date.now()}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execGit(['worktree', 'add', '-b', branch, target, 'HEAD'], { cwd: root, stdio: 'inherit' });
  const claude_permissions = inheritClaudePermissions(root, target);
  const meta = {
    intent: intentId,
    parent_branch: parentBranch,
    branch,
    base_sha: baseSha,
    path: target,
    claude_permissions,
    created_at: new Date().toISOString(),
  };
  writeMeta(root, intentId, meta);
  return decorateMeta(root, meta, 'created');
}

function restoreFromMeta(root, intentId) {
  const meta = readMeta(root, intentId);
  if (!gitSucceeds(['show-ref', '--verify', `refs/heads/${meta.branch}`], { cwd: root })) {
    throw new Error(
      [
        `Intent worktree metadata exists but its branch is missing: ${meta.branch}`,
        `Metadata file: ${path.relative(root, metaPath(root, intentId))}`,
        'Inspect the metadata and intent artifacts before creating a replacement worktree.',
      ].join('\n'),
    );
  }

  fs.mkdirSync(path.dirname(meta.path), { recursive: true });
  execGit(['worktree', 'add', meta.path, meta.branch], { cwd: root, stdio: 'inherit' });
  const claude_permissions = inheritClaudePermissions(root, meta.path);
  const restored = {
    ...meta,
    claude_permissions,
    restored_at: new Date().toISOString(),
  };
  return decorateMeta(root, restored, 'restored');
}

function syncWithParent(meta) {
  if (!gitSucceeds(['show-ref', '--verify', `refs/heads/${meta.parent_branch}`], { cwd: meta.path })) {
    return { synced: false, reason: 'parent_branch ref missing' };
  }
  const behindRaw = execGit(['rev-list', '--count', `HEAD..${meta.parent_branch}`], { cwd: meta.path });
  const behind = parseInt(behindRaw || '0', 10);
  if (!behind) return { synced: false, behind: 0 };
  execGit(['merge', '--no-edit', meta.parent_branch], { cwd: meta.path, stdio: 'inherit' });
  return { synced: true, behind };
}

function ensure(root, intentId) {
  const target = worktreePath(root, intentId);
  const metaFile = metaPath(root, intentId);
  const hasTarget = fs.existsSync(target);
  const hasMeta = fs.existsSync(metaFile);

  if (!hasTarget && !hasMeta) return create(root, intentId);

  if (hasTarget && hasMeta) {
    const meta = readMeta(root, intentId);
    const sync = syncWithParent(meta);
    return decorateMeta(root, sync.synced ? { ...meta, synced_with_parent: sync.behind } : meta, 'resumed');
  }

  if (hasTarget && !hasMeta) {
    throw new Error(
      [
        `Intent worktree exists without metadata: ${path.relative(root, target)}`,
        'This looks like an interrupted or manually altered session.',
        `Either restore ${path.relative(root, metaFile)} or inspect/commit/discard the worktree before creating a new one.`,
      ].join('\n'),
    );
  }

  const restored = restoreFromMeta(root, intentId);
  const sync = syncWithParent(restored);
  return sync.synced ? { ...restored, synced_with_parent: sync.behind } : restored;
}

function merge(root, intentId) {
  const meta = readMeta(root, intentId);
  const dirty = execGit(['status', '--short'], { cwd: meta.path });
  if (dirty) {
    throw new Error(`Intent worktree has uncommitted changes. Commit or stash before merge:\n${dirty}`);
  }

  const current = currentBranch(root);
  if (current !== meta.parent_branch) {
    execGit(['switch', meta.parent_branch], { cwd: root, stdio: 'inherit' });
  }

  execGit(['merge', '--no-ff', meta.branch], { cwd: root, stdio: 'inherit' });
  return {
    ...meta,
    merged_at: new Date().toISOString(),
    state_path: statePath(root),
    state_note: 'If state.yaml conflicted, keep only entries for this intent and its run IDs from the intent branch.',
  };
}

function cleanup(root, intentId) {
  const meta = readMeta(root, intentId);
  execGit(['worktree', 'remove', meta.path], { cwd: root, stdio: 'inherit' });
  if (fs.existsSync(metaPath(root, intentId))) fs.unlinkSync(metaPath(root, intentId));
  return { ...meta, cleaned_up_at: new Date().toISOString() };
}

function subworktreePath(root, intentId, itemId) {
  return path.join(
    root,
    '.claude',
    'worktrees',
    `fire-item-${safeBranchToken(intentId)}-${safeBranchToken(itemId)}`,
  );
}

function subworktreeBranch(intentId, itemId) {
  return `fire-item/${safeBranchToken(intentId)}/${safeBranchToken(itemId)}-${Date.now()}`;
}

function subworktreeCreate(root, intentId, itemId) {
  const intentMeta = readMeta(root, intentId);
  const target = subworktreePath(root, intentId, itemId);
  if (fs.existsSync(target)) {
    throw new Error(`Sub-worktree already exists for ${intentId}/${itemId}: ${path.relative(root, target)}`);
  }
  const branch = subworktreeBranch(intentId, itemId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execGit(['worktree', 'add', '-b', branch, target, intentMeta.branch], { cwd: root, stdio: 'inherit' });
  inheritClaudePermissions(root, target);
  return {
    intent: intentId,
    work_item: itemId,
    branch,
    intent_branch: intentMeta.branch,
    intent_branch_worktree: intentMeta.path,
    path: target,
    created_at: new Date().toISOString(),
  };
}

function subworktreeMerge(root, intentId, itemId) {
  const intentMeta = readMeta(root, intentId);
  const target = subworktreePath(root, intentId, itemId);
  if (!fs.existsSync(target)) {
    throw new Error(`Sub-worktree missing for ${intentId}/${itemId}: ${path.relative(root, target)}`);
  }
  const dirty = execGit(['status', '--short'], { cwd: target });
  if (dirty) {
    throw new Error(`Sub-worktree has uncommitted changes:\n${dirty}`);
  }
  const subBranch = execGit(['branch', '--show-current'], { cwd: target });
  if (!subBranch) {
    throw new Error(
      `Sub-worktree is in detached HEAD state; cannot determine branch to merge: ${path.relative(root, target)}`,
    );
  }
  execGit(['merge', '--no-ff', subBranch], { cwd: intentMeta.path, stdio: 'inherit' });
  execGit(['worktree', 'remove', target], { cwd: root, stdio: 'inherit' });
  execGit(['branch', '-D', subBranch], { cwd: root, stdio: 'inherit' });
  return {
    intent: intentId,
    work_item: itemId,
    merged_branch: subBranch,
    intent_branch: intentMeta.branch,
    intent_branch_worktree: intentMeta.path,
    merged_at: new Date().toISOString(),
  };
}

function main() {
  const intentId = process.argv[2];
  const action = process.argv[3];
  if (!intentId || !action || intentId === '--help' || intentId === '-h') {
    console.log(usage());
    process.exit(intentId ? 0 : 1);
  }

  const root = execGit(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  let result;
  if (action === 'create') result = create(root, intentId);
  else if (action === 'ensure') result = ensure(root, intentId);
  else if (action === 'merge') result = merge(root, intentId);
  else if (action === 'cleanup') result = cleanup(root, intentId);
  else if (action === 'subworktree-create') {
    const itemId = process.argv[4];
    if (!itemId) { console.log(usage()); process.exit(1); }
    result = subworktreeCreate(root, intentId, itemId);
  }
  else if (action === 'subworktree-merge') {
    const itemId = process.argv[4];
    if (!itemId) { console.log(usage()); process.exit(1); }
    result = subworktreeMerge(root, intentId, itemId);
  }
  else {
    console.log(usage());
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { create, ensure, merge, cleanup, subworktreeCreate, subworktreeMerge };
