'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const script = require('../specsmd-fire-intent-worktree.cjs');

function git(args, cwd) {
  return execFileSync('git', args, { cwd: cwd, encoding: 'utf8' });
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fire-subwt-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@test.local'], dir);
  git(['config', 'user.name', 'test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

test('subworktreeCreate adds branch fire-item-... off intent branch and creates worktree', function () {
  const root = tmpRepo();
  const intentId = 'demo-intent';
  const itemId = '1-do-thing';

  const intent = script.create(root, intentId);
  assert.ok(fs.existsSync(intent.path));

  // Commit a distinctive marker on the intent branch so we can verify the
  // sub-worktree history descends from it.
  fs.writeFileSync(path.join(intent.path, 'INTENT_MARKER.md'), 'intent-only\n');
  git(['add', 'INTENT_MARKER.md'], intent.path);
  git(['commit', '-q', '-m', 'chore: intent-only marker'], intent.path);

  const sub = script.subworktreeCreate(root, intentId, itemId);
  assert.ok(fs.existsSync(sub.path), 'sub-worktree path exists');
  assert.match(sub.branch, /^fire-item\//);
  assert.strictEqual(sub.intent, intentId);
  assert.strictEqual(sub.work_item, itemId);

  const branches = git(['branch', '--list'], root);
  assert.ok(branches.includes('fire-item/'), 'fire-item branch listed');

  // Behavioral contract: the sub-worktree's history must include the intent-only marker.
  const log = git(['log', '--oneline'], sub.path);
  assert.ok(log.includes('intent-only marker'), 'sub-worktree branched off intent branch');
});

test('ensure syncs intent branch with parent when parent advanced after the worktree was created', function () {
  const root = tmpRepo();
  const intentId = 'demo-intent-3';

  const intent = script.create(root, intentId);
  assert.ok(fs.existsSync(intent.path));

  // Advance parent (main) with a commit that the intent branch does NOT have.
  fs.writeFileSync(path.join(root, 'PARENT_ONLY.md'), 'parent-only\n');
  git(['add', 'PARENT_ONLY.md'], root);
  git(['commit', '-q', '-m', 'feat: parent-only commit'], root);

  // Sanity: the intent worktree does not yet see the parent's new commit.
  assert.ok(
    !fs.existsSync(path.join(intent.path, 'PARENT_ONLY.md')),
    'intent worktree starts behind parent',
  );

  const resumed = script.ensure(root, intentId);
  assert.strictEqual(resumed.synced_with_parent, 1, 'ensure reports 1 commit synced from parent');
  assert.ok(
    fs.existsSync(path.join(intent.path, 'PARENT_ONLY.md')),
    'parent commit now present on intent branch after ensure',
  );

  // Re-running ensure when already up-to-date is a no-op (no synced_with_parent field).
  const resumedAgain = script.ensure(root, intentId);
  assert.strictEqual(resumedAgain.synced_with_parent, undefined, 'no resync when already up to date');
});

test('subworktreeMerge brings sub-branch commit into intent branch and removes sub-worktree', function () {
  const root = tmpRepo();
  const intentId = 'demo-intent-2';
  const itemId = '2-build-thing';

  script.create(root, intentId);
  const sub = script.subworktreeCreate(root, intentId, itemId);
  fs.writeFileSync(path.join(sub.path, 'NEW.md'), 'hello\n');
  git(['add', 'NEW.md'], sub.path);
  git(['commit', '-q', '-m', 'feat: add NEW'], sub.path);

  const merged = script.subworktreeMerge(root, intentId, itemId);
  assert.strictEqual(merged.work_item, itemId);
  assert.ok(!fs.existsSync(sub.path), 'sub-worktree removed');
  assert.ok(
    fs.existsSync(path.join(merged.intent_branch_worktree, 'NEW.md')),
    'merged file appears on intent branch worktree',
  );
});
