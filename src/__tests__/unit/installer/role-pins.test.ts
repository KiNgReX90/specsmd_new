import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { SRC, openSandbox, readLock, sha256, snapshot, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');

const CLAUDE_ROLE_FILES: Record<string, string[]> = {
  builder: [
    '.claude/commands/specsmd-inferno-builder.md',
    '.claude/agents/specsmd-inferno-builder.md',
    '.specsmd/inferno/agents/builder/agent.md',
  ],
  'builder-cheap': [
    '.claude/commands/specsmd-inferno-builder-cheap.md',
    '.claude/agents/specsmd-inferno-builder-cheap.md',
    '.specsmd/inferno/agents/builder-cheap/agent.md',
  ],
  config: ['.claude/commands/specsmd-inferno-config.md', '.claude/agents/specsmd-inferno-config.md'],
  oracle: [
    '.claude/commands/specsmd-inferno-oracle.md',
    '.claude/agents/specsmd-inferno-oracle.md',
    '.specsmd/inferno/agents/oracle/agent.md',
  ],
  planner: ['.claude/agents/specsmd-inferno-planner.md', '.specsmd/inferno/agents/planner/agent.md'],
  reviewer: [
    '.claude/commands/specsmd-inferno-reviewer.md',
    '.claude/agents/specsmd-inferno-reviewer.md',
    '.specsmd/inferno/agents/reviewer/agent.md',
  ],
  scanner: [
    '.claude/commands/specsmd-inferno-scanner.md',
    '.claude/agents/specsmd-inferno-scanner.md',
    '.specsmd/inferno/agents/scanner/agent.md',
  ],
};

function pins(rel: string) {
  const fm = (readFileSync(rel, 'utf8').match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1];
  return [fm.match(/^model:\s*(\S+)\s*$/m)?.[1], fm.match(/^effort:\s*(\S+)\s*$/m)?.[1]];
}

// Subagents write the 5 minute cache by default. The three roles that wait on a warm resume ask for 1 hour.
const CACHE_1H_ROLES = ['builder', 'builder-escalate', 'reviewer'];
const CACHE_5M_ROLES = ['builder-cheap', 'config', 'oracle', 'planner', 'scanner'];

function cacheTtl(rel: string) {
  const fm = (readFileSync(rel, 'utf8').match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1];
  return fm.match(/^experimental:\n {2}cacheTtl: (\S+)$/m)?.[1];
}

function installed(role: string) {
  return [`.claude/commands/specsmd-inferno-${role}.md`, `.claude/agents/specsmd-inferno-${role}.md`];
}

function tomlPins(rel: string) {
  const text = readFileSync(rel, 'utf8');
  return [text.match(/^model = "([^"]*)"$/m)?.[1], text.match(/^model_reasoning_effort = "([^"]*)"$/m)?.[1]];
}

describe.sequential('role pins from host config', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => {
    box = openSandbox('specsmd-roles-');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  it('installs the source defaults when the host config names no role', async () => {
    await installFlow('inferno', ['claude']);
    const expected: Record<string, [string, string]> = {
      builder: ['claude-opus-5-5', 'high'],
      'builder-cheap': ['claude-sonnet-5-5', 'high'],
      config: ['claude-sonnet-5-5', 'high'],
      oracle: ['claude-fable-5-1', 'xhigh'],
      planner: ['claude-opus-5-5', 'xhigh'],
      reviewer: ['claude-opus-5-5', 'xhigh'],
      scanner: ['claude-sonnet-5-5', 'high'],
    };
    for (const [role, files] of Object.entries(CLAUDE_ROLE_FILES)) {
      for (const rel of files) expect(pins(rel), rel).toEqual(expected[role]);
    }
  });

  it('asks for the 1 hour cache on the builder, builder-escalate and reviewer agents only', async () => {
    await installFlow('inferno', ['claude']);
    for (const role of CACHE_1H_ROLES) for (const rel of installed(role)) expect(cacheTtl(rel), rel).toBe('1h');
    for (const role of CACHE_5M_ROLES) {
      for (const rel of installed(role)) {
        if (existsSync(rel)) expect(readFileSync(rel, 'utf8'), rel).not.toMatch(/^experimental:/m);
      }
    }
  });

  it('keeps the 1 hour cache when a role pins its model and effort', async () => {
    write('.specs-inferno/config.yaml', 'roles:\n  builder: {model: claude-test-model, effort: low}\n  reviewer: {effort: max}\n');
    await installFlow('inferno', ['claude']);
    for (const rel of installed('builder')) {
      expect(pins(rel), rel).toEqual(['claude-test-model', 'low']);
      expect(cacheTtl(rel), rel).toBe('1h');
    }
    for (const rel of installed('reviewer')) expect(cacheTtl(rel), rel).toBe('1h');
  });

  it('renders a Claude role entry into every file of that role and records the rendered bytes', async () => {
    write('.specs-inferno/config.yaml', 'roles:\n  builder: {model: claude-test-model, effort: low}\n');
    await installFlow('inferno', ['claude']);

    for (const rel of CLAUDE_ROLE_FILES.builder) expect(pins(rel), rel).toEqual(['claude-test-model', 'low']);
    for (const rel of CLAUDE_ROLE_FILES.oracle) expect(pins(rel), rel).toEqual(['claude-fable-5-1', 'xhigh']);
    const lock = readLock();
    for (const rel of CLAUDE_ROLE_FILES.builder) expect(lock.files[rel].sha256).toBe(sha256(readFileSync(rel)));
  });

  it('renders only the key a role entry names and never pins the orchestrator', async () => {
    write('.specs-inferno/config.yaml', 'roles:\n  oracle: {effort: max}\n  orchestrator: {model: claude-test-model}\n');
    await installFlow('inferno', ['claude']);

    for (const rel of CLAUDE_ROLE_FILES.oracle) expect(pins(rel), rel).toEqual(['claude-fable-5-1', 'max']);
    expect(pins('.claude/commands/specsmd-inferno.md')).toEqual([undefined, undefined]);
    expect(pins('.specsmd/inferno/agents/orchestrator/agent.md')).toEqual([undefined, undefined]);
  });

  it('re-renders a changed role entry on the next install without force', async () => {
    write('.specs-inferno/config.yaml', 'roles:\n  builder: {model: claude-test-model, effort: low}\n');
    await installFlow('inferno', ['claude']);
    write('.specs-inferno/config.yaml', 'roles:\n  builder: {model: claude-other-model, effort: medium}\n');
    await installFlow('inferno', ['claude']);

    for (const rel of CLAUDE_ROLE_FILES.builder) expect(pins(rel), rel).toEqual(['claude-other-model', 'medium']);
  });

  it('renders a Codex role into the toml its agent key names, or the toml named after the role', async () => {
    write('.specs-inferno/config.codex.yaml', [
      'roles:',
      '  builder_cheap:',
      '    agent: specsmd_inferno_builder_cheap',
      '    model: gpt-test-cheap',
      '    reasoning_effort: max',
      '  oracle:',
      '    model: gpt-test-oracle',
      '',
    ].join('\n'));
    await installFlow('inferno', ['codex']);

    expect(tomlPins('.codex/agents/specsmd_inferno_builder_cheap.toml')).toEqual(['gpt-test-cheap', 'max']);
    expect(tomlPins('.codex/agents/specsmd_inferno_oracle.toml')).toEqual(['gpt-test-oracle', 'xhigh']);
    expect(tomlPins('.codex/agents/specsmd_inferno_builder_strong.toml')).toEqual(['gpt-6.1-sol', 'xhigh']);
    const lock = readLock();
    const rel = '.codex/agents/specsmd_inferno_builder_cheap.toml';
    expect(lock.files[rel].sha256).toBe(sha256(readFileSync(rel)));
  });

  it('names no model but the host pin in any Codex skill text, so a config run keeps the pin', async () => {
    const agents = path.join(SRC, 'flows/inferno/codex/agents');
    const tomls = readdirSync(agents).filter((name) => /^specsmd_inferno_[a-z_]+\.toml$/.test(name));
    const roles = tomls.map((name) => name.slice('specsmd_inferno_'.length, -'.toml'.length));
    const defaults = [...new Set(tomls.map((name) => tomlPins(path.join(agents, name))[0]))];
    expect(roles.length).toBeGreaterThan(0);
    expect(defaults.every(Boolean)).toBe(true);
    write('.specs-inferno/config.codex.yaml', [
      'roles:',
      ...roles.map((role) => `  ${role}: {agent: specsmd_inferno_${role}, model: gpt-test-${role}, reasoning_effort: max}`),
      '',
    ].join('\n'));
    await installFlow('inferno', ['codex']);

    for (const role of roles) expect(tomlPins(`.codex/agents/specsmd_inferno_${role}.toml`)).toEqual([`gpt-test-${role}`, 'max']);
    const texts = Object.keys(snapshot(box.root)).filter((rel) => rel.startsWith('.agents/') && rel.endsWith('.md'));
    expect(texts.length).toBeGreaterThan(0);
    for (const rel of texts) {
      const text = readFileSync(rel, 'utf8');
      for (const model of defaults) expect(text.includes(model), `${rel} names ${model}`).toBe(false);
    }
    const config = readFileSync('.agents/skills/specsmd-inferno-config/references/procedure.md', 'utf8');
    expect(config).toContain('An existing `<pin>` stays unless the user changes it');
    expect(config).toContain('a created one copies `model` and `model_reasoning_effort` from `.codex/agents/<agent>.toml`');
    expect(config).not.toMatch(/fixed compatibility values|exact `agent`, `model`/);
  });

  it('matches a Codex toml by the agent key before the role name', async () => {
    write('.specs-inferno/config.codex.yaml', [
      'roles:',
      '  cheap: {agent: specsmd_inferno_builder_cheap, model: gpt-test-cheap}',
      '  oracle: {agent: specsmd_inferno_planner, model: gpt-test-planner}',
      '',
    ].join('\n'));
    await installFlow('inferno', ['codex']);

    expect(tomlPins('.codex/agents/specsmd_inferno_builder_cheap.toml')[0]).toBe('gpt-test-cheap');
    expect(tomlPins('.codex/agents/specsmd_inferno_planner.toml')[0]).toBe('gpt-test-planner');
    expect(tomlPins('.codex/agents/specsmd_inferno_oracle.toml')).toEqual(['gpt-6-astra', 'xhigh']);
  });

  it.each([`claude"x`, `claude'x`, 'a #b', 'a b', 'foo:', '{x}', 'claude\nname: evil'])(
    'refuses the role value %j in a Claude and a Codex role and leaves the host untouched',
    async (value) => {
      const quoted = JSON.stringify(value);
      for (const [file, entry, tool, key] of [
        ['.specs-inferno/config.yaml', `builder: {model: ${quoted}}`, 'claude', 'roles.builder.model'],
        ['.specs-inferno/config.codex.yaml', `oracle: {reasoning_effort: ${quoted}}`, 'codex', 'roles.oracle.reasoning_effort'],
      ]) {
        write(file, `roles:\n  ${entry}\n`);
        const before = snapshot(box.root);
        await expect(installFlow('inferno', [tool])).rejects.toThrow(key);
        expect(snapshot(box.root)).toEqual(before);
      }
    },
    30_000
  );
});
