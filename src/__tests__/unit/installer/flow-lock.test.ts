import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { LOCK, SRC, openSandbox, readLock, sha256, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');
const CodexInstaller = require('../../../lib/installers/CodexInstaller');

const COMMAND = '.claude/commands/specsmd-inferno.md';
const AGENT = '.claude/agents/specsmd-inferno.md';

function managedBlock(text: string) {
  const start = text.indexOf(CodexInstaller.MANAGED_START);
  const end = text.indexOf(CodexInstaller.MANAGED_END) + CodexInstaller.MANAGED_END.length;
  return text.slice(start, end);
}

describe.sequential('flow.lock', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;
  let logs: string[];

  beforeEach(() => {
    box = openSandbox('specsmd-flow-lock-');
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  it('records the source commit, the version and a sha256 for every installed file', async () => {
    write('AGENTS.md', '# Project rules\n');
    await installFlow('inferno', ['claude', 'codex']);

    const lock = readLock();
    expect(lock.flow).toBe('inferno');
    expect(lock.version).toBe(require('../../../package.json').version);
    expect(lock.source_commit).toMatch(/^([0-9a-f]{40}|unknown)$/);

    const paths = Object.keys(lock.files);
    for (const rel of [
      COMMAND,
      AGENT,
      '.specsmd/inferno/check-lock.cjs',
      '.specsmd/inferno/README.md',
      '.specsmd/inferno/agents/builder/agent.md',
      '.agents/skills/specsmd-inferno/SKILL.md',
      '.codex/agents/specsmd_inferno_builder_strong.toml',
      '.codex/rules/claude-build.rules',
    ]) {
      expect(paths).toContain(rel);
    }
    expect(paths).not.toContain(LOCK);
    expect(paths).not.toContain('.specsmd/manifest.yaml');
    expect(paths).toEqual([...paths].sort());

    for (const rel of paths) {
      if (rel === 'AGENTS.md') continue;
      expect(lock.files[rel].sha256, rel).toBe(sha256(readFileSync(rel)));
    }
    // AGENTS.md is shared with the host, so only the managed block is the flow's.
    const agents = readFileSync('AGENTS.md', 'utf8');
    expect(lock.files['AGENTS.md'].block).toEqual([CodexInstaller.MANAGED_START, CodexInstaller.MANAGED_END]);
    expect(lock.files['AGENTS.md'].sha256).toBe(sha256(managedBlock(agents)));
  });

  it('names every host file it overwrites on a first install and writes it anyway', async () => {
    write(COMMAND, 'host owned command\n');
    write(AGENT, readFileSync(`${SRC}/flows/inferno/commands/inferno.md`, 'utf8'));

    await installFlow('inferno', ['claude']);

    const notice = logs.join('\n');
    expect(notice).toContain(COMMAND);
    expect(notice).not.toContain(AGENT);
    expect(readFileSync(COMMAND, 'utf8')).toBe(readFileSync(`${SRC}/flows/inferno/commands/inferno.md`, 'utf8'));
    expect(existsSync(LOCK)).toBe(true);
  });

  it('refuses to overwrite a host edit of an installed file and names it', async () => {
    await installFlow('inferno', ['claude']);
    const lockBefore = readFileSync(LOCK, 'utf8');
    write(COMMAND, 'edited by the host\n');
    write('.specsmd/inferno/README.md', 'edited readme\n');

    await expect(installFlow('inferno', ['claude'])).rejects.toThrow(/specsmd-inferno\.md[\s\S]*README\.md|README\.md[\s\S]*specsmd-inferno\.md/);

    expect(readFileSync(COMMAND, 'utf8')).toBe('edited by the host\n');
    expect(readFileSync('.specsmd/inferno/README.md', 'utf8')).toBe('edited readme\n');
    expect(readFileSync(LOCK, 'utf8')).toBe(lockBefore);
  });

  it('marks the refusal so a caller can exit non-zero with the file list', async () => {
    await installFlow('inferno', ['claude']);
    write(COMMAND, 'edited by the host\n');
    const error = await installFlow('inferno', ['claude']).catch((e: any) => e);
    expect(error.code).toBe('HOST_EDITED');
    expect(error.files).toEqual([COMMAND]);
  });

  it('overwrites host edits when forced', async () => {
    await installFlow('inferno', ['claude']);
    write(COMMAND, 'edited by the host\n');

    await installFlow('inferno', ['claude'], { force: true });

    expect(readFileSync(COMMAND, 'utf8')).toBe(readFileSync(`${SRC}/flows/inferno/commands/inferno.md`, 'utf8'));
    expect(readLock().files[COMMAND].sha256).toBe(sha256(readFileSync(COMMAND)));
  });

  it('accepts host text around the AGENTS.md block and refuses an edit inside it', async () => {
    write('AGENTS.md', '# Project rules\n');
    await installFlow('inferno', ['codex']);

    writeFileSync('AGENTS.md', `${readFileSync('AGENTS.md', 'utf8')}\nHost footer.\n`);
    await installFlow('inferno', ['codex']);
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('Host footer.');

    const text = readFileSync('AGENTS.md', 'utf8');
    writeFileSync('AGENTS.md', text.replace(CodexInstaller.MANAGED_END, `edited inside\n${CodexInstaller.MANAGED_END}`));
    await expect(installFlow('inferno', ['codex'])).rejects.toThrow(/AGENTS\.md/);
  });
});
