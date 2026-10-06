import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { LOCK, budgetStub, openSandbox, readLock, sha256, snapshot, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');
const CodexInstaller = require('../../../lib/installers/CodexInstaller');

const COMMAND = '.claude/commands/specsmd-inferno.md';
const OLD = '.specsmd/inferno/agents/orchestrator/retired.cjs';

/** Pretend an older install wrote a file that the current source no longer ships. */
function recordRetiredFile() {
  write(OLD, 'retired\n');
  const lock = readLock();
  lock.files[OLD] = { sha256: sha256('retired\n') };
  writeFileSync(LOCK, JSON.stringify(lock, null, 2));
}

describe.sequential('install lifecycle', () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => {
    box = openSandbox('specsmd-flow-life-');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { chmodSync(path.join(box.root, '.codex/rules'), 0o755); } catch { /* not created */ }
    box.close();
  });

  it('removes a file the old lock recorded and the new install no longer writes', async () => {
    write('.specsmd/inferno/agents/host-own.md', 'host file no lock recorded\n');
    await installFlow('inferno', ['claude']);
    recordRetiredFile();

    await installFlow('inferno', ['claude']);

    expect(existsSync(OLD)).toBe(false);
    expect(Object.keys(readLock().files)).not.toContain(OLD);
    expect(readFileSync('.specsmd/inferno/agents/host-own.md', 'utf8')).toBe('host file no lock recorded\n');
  });

  it('refuses to remove a retired file the host edited', async () => {
    await installFlow('inferno', ['claude']);
    recordRetiredFile();
    write(OLD, 'host edit of a retired file\n');

    await expect(installFlow('inferno', ['claude'])).rejects.toThrow(/retired\.cjs/);
    expect(readFileSync(OLD, 'utf8')).toBe('host edit of a retired file\n');
  });

  it('drops the Codex bundle and the AGENTS.md block when Codex leaves the tool list', async () => {
    write('AGENTS.md', '# Project rules\n');
    write('.codex/agents/user_agent.toml', 'name = "user_agent"\n');
    await installFlow('inferno', ['claude', 'codex']);

    await installFlow('inferno', ['claude']);

    expect(existsSync('.codex/agents/specsmd_inferno_builder_strong.toml')).toBe(false);
    expect(existsSync('.agents/skills/specsmd-inferno')).toBe(false);
    expect(existsSync('.specsmd/inferno/README.codex.md')).toBe(false);
    expect(readFileSync('.codex/agents/user_agent.toml', 'utf8')).toContain('user_agent');
    const agents = readFileSync('AGENTS.md', 'utf8');
    expect(agents).toContain('# Project rules');
    expect(agents).not.toContain(CodexInstaller.MANAGED_START);
    expect(Object.keys(readLock().files).some((rel) => rel.startsWith('.codex/'))).toBe(false);
  });

  it('restores exactly the previous state when a write fails on a first install', async () => {
    write(COMMAND, 'host command before any lock\n');
    write('.specsmd/keep.txt', 'host data\n');
    write('AGENTS.md', '# Project rules\n');
    write('.codex/rules/user.rules', 'user rule\n');
    chmodSync('.codex/rules', 0o555);
    const before = snapshot(box.root);

    await expect(installFlow('inferno', ['claude', 'codex'])).rejects.toThrow();

    chmodSync('.codex/rules', 0o755);
    expect(snapshot(box.root)).toEqual(before);
  });

  it('restores the previous install, its lock and its retired files when a write fails', async () => {
    write('AGENTS.md', '# Project rules\n');
    await installFlow('inferno', ['claude', 'codex']);
    recordRetiredFile();
    const before = snapshot(box.root);
    chmodSync('.codex/rules', 0o555);

    await expect(installFlow('inferno', ['claude'])).rejects.toThrow();

    chmodSync('.codex/rules', 0o755);
    expect(snapshot(box.root)).toEqual(before);
  });

  it('runs the budget script from INFERNO_FLOW_BUDGET on the host root', async () => {
    const script = budgetStub(path.join(box.base, 'budget.py'), 0, 'within budget');
    process.env.INFERNO_FLOW_BUDGET = script;

    await installFlow('inferno', ['claude']);

    expect(readFileSync(`${script}.args`, 'utf8').split('\n')).toEqual(['--repo', box.root, '--quiet']);
  });

  it('restores the previous state and fails with the budget output when over budget', async () => {
    write(COMMAND, 'host command\n');
    const before = snapshot(box.root);
    budgetStub(path.join(box.data, 'specsmd-inferno/flow-text-budget.py'), 1, 'planner 4501/4500 words');

    await expect(installFlow('inferno', ['claude'])).rejects.toThrow(/planner 4501\/4500 words/);

    expect(snapshot(box.root)).toEqual(before);
  });
});
