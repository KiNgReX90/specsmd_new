import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';

const CodexInstaller = require('../../../lib/installers/CodexInstaller');
const { installFlow, rollback } = require('../../../lib/installer');

const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');
const SKILLS = [
  'specsmd-inferno',
  'specsmd-inferno-planner',
  'specsmd-inferno-builder',
  'specsmd-inferno-config',
];
const AGENTS: Record<string, [string, string]> = {
  specsmd_inferno_orchestrator: ['gpt-5.6-sol', 'xhigh'],
  specsmd_inferno_planner: ['gpt-5.6-sol', 'xhigh'],
  specsmd_inferno_builder_strong: ['gpt-5.6-sol', 'xhigh'],
  specsmd_inferno_config: ['gpt-5.6-terra', 'high'],
  specsmd_inferno_builder_cheap: ['gpt-5.6-terra', 'high'],
};

function tomlStrings(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"\n]*)"\s*$/gm)]
      .map((match) => [match[1], match[2]])
  );
}

describe.sequential('CodexInstaller native bundle', () => {
  let originalCwd: string;
  let sandbox: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    sandbox = mkdtempSync(path.join(os.tmpdir(), 'specsmd-codex-installer-'));
    process.chdir(sandbox);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('installs exact skills and agents while preserving project instructions', async () => {
    const projectInstructions = '# Project instructions\n\nKeep this project-owned rule.\n';
    const claudeInstructions = '# CLAUDE.md\n\nClaude-owned rule.\n';
    writeFileSync('AGENTS.md', projectInstructions);
    writeFileSync('CLAUDE.md', claudeInstructions);
    mkdirSync('.agents/skills/user-skill', { recursive: true });
    writeFileSync('.agents/skills/user-skill/SKILL.md', 'user owned\n');
    mkdirSync('.codex/agents', { recursive: true });
    writeFileSync('.codex/agents/user_agent.toml', 'name = "user_agent"\n');

    const installer = new CodexInstaller();
    await installer.installCommands(INFERNO, {});

    for (const skill of SKILLS) {
      for (const relative of ['SKILL.md', 'references/procedure.md', 'agents/openai.yaml']) {
        expect(existsSync(path.join('.agents/skills', skill, relative))).toBe(true);
      }
    }
    expect(readdirSync('.agents/skills').sort()).toEqual([...SKILLS, 'user-skill'].sort());

    const installedAgentFiles = readdirSync('.codex/agents')
      .filter((file) => file.startsWith('specsmd_') && file.endsWith('.toml'));
    expect(installedAgentFiles).toHaveLength(5);
    const seen = new Set<string>();
    for (const file of installedAgentFiles) {
      const source = readFileSync(path.join('.codex/agents', file), 'utf8');
      const config = tomlStrings(source);
      expect(config.name).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect([config.model, config.model_reasoning_effort]).toEqual(AGENTS[config.name]);
      expect(source).toMatch(/^developer_instructions\s*=\s*"""/m);
      expect(source).not.toMatch(/^sandbox_mode\s*=/m);
      seen.add(config.name);
    }
    expect([...seen].sort()).toEqual(Object.keys(AGENTS).sort());

    let agents = readFileSync('AGENTS.md', 'utf8');
    expect(agents.startsWith(projectInstructions)).toBe(true);
    expect(agents).toContain(CodexInstaller.MANAGED_START);
    expect(agents).toContain(CodexInstaller.MANAGED_END);
    expect(readFileSync('CLAUDE.md', 'utf8')).toBe(claudeInstructions);

    writeFileSync('AGENTS.md', `${agents}\nUser footer after managed block.\n`);
    await installer.installCommands(INFERNO, {});
    agents = readFileSync('AGENTS.md', 'utf8');
    expect(agents.match(/<!-- specsmd:codex:start -->/g)).toHaveLength(1);
    expect(agents).toContain('User footer after managed block.');

    await installer.uninstallCommands(INFERNO, {});
    for (const skill of SKILLS) {
      expect(existsSync(path.join('.agents/skills', skill))).toBe(false);
    }
    for (const name of Object.keys(AGENTS)) {
      expect(existsSync(path.join('.codex/agents', `${name}.toml`))).toBe(false);
    }
    expect(readFileSync('.agents/skills/user-skill/SKILL.md', 'utf8')).toBe('user owned\n');
    expect(readFileSync('.codex/agents/user_agent.toml', 'utf8')).toContain('user_agent');
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('Keep this project-owned rule.');
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('User footer after managed block.');
    expect(readFileSync('AGENTS.md', 'utf8')).not.toContain(CodexInstaller.MANAGED_START);
    expect(readFileSync('CLAUDE.md', 'utf8')).toBe(claudeInstructions);
  });

  it('creates AGENTS.md from CLAUDE.md without changing Claude instructions', async () => {
    const claudeInstructions = '# CLAUDE.md, Example\n\nKeep the complete charter.\n';
    writeFileSync('CLAUDE.md', claudeInstructions);

    const installer = new CodexInstaller();
    await installer.installCommands(INFERNO, {});

    const agents = readFileSync('AGENTS.md', 'utf8');
    expect(agents).toMatch(/^# AGENTS\.md, Example/m);
    expect(agents).toContain('Keep the complete charter.');
    expect(agents).toContain(CodexInstaller.MANAGED_START);
    expect(readFileSync('CLAUDE.md', 'utf8')).toBe(claudeInstructions);

    await installer.uninstallCommands(INFERNO, {});
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('Keep the complete charter.');
    expect(readFileSync('AGENTS.md', 'utf8')).not.toContain(CodexInstaller.MANAGED_START);
    expect(readFileSync('CLAUDE.md', 'utf8')).toBe(claudeInstructions);
  });

  it('keeps command conversion as a cleanup-safe fallback for legacy flows', async () => {
    const legacyFlow = path.join(sandbox, 'legacy-flow');
    mkdirSync(path.join(legacyFlow, 'commands'), { recursive: true });
    writeFileSync(
      path.join(legacyFlow, 'commands/example.md'),
      '---\ndescription: Example legacy command\n---\n\n# Legacy body\n'
    );
    mkdirSync('.codex/skills/specsmd-unrelated', { recursive: true });
    writeFileSync('.codex/skills/specsmd-unrelated/SKILL.md', 'preserve me\n');

    const installer = new CodexInstaller();
    await installer.installCommands(legacyFlow, {});
    expect(readFileSync('.codex/skills/specsmd-example/SKILL.md', 'utf8'))
      .toContain('# Legacy body');

    await installer.uninstallCommands(legacyFlow, {});
    expect(existsSync('.codex/skills/specsmd-example')).toBe(false);
    expect(readFileSync('.codex/skills/specsmd-unrelated/SKILL.md', 'utf8'))
      .toBe('preserve me\n');
  });

  it('copies Codex documentation through package install and rolls back managed assets', async () => {
    writeFileSync('AGENTS.md', '# Existing project instructions\n');
    mkdirSync('.agents/skills/user-skill', { recursive: true });
    writeFileSync('.agents/skills/user-skill/SKILL.md', 'preserve me\n');

    await installFlow('inferno', ['codex']);
    expect(existsSync('.specsmd/inferno/README.codex.md')).toBe(true);
    expect(existsSync('.specsmd/inferno/README.md')).toBe(true);
    expect(existsSync('.agents/skills/specsmd-inferno/SKILL.md')).toBe(true);
    expect(existsSync('.codex/agents/specsmd_inferno_orchestrator.toml')).toBe(true);

    await rollback('inferno', ['codex']);
    expect(existsSync('.specsmd')).toBe(false);
    expect(existsSync('.agents/skills/specsmd-inferno')).toBe(false);
    expect(readFileSync('.agents/skills/user-skill/SKILL.md', 'utf8')).toBe('preserve me\n');
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('# Existing project instructions');
    expect(readFileSync('AGENTS.md', 'utf8')).not.toContain(CodexInstaller.MANAGED_START);
  });

  it('does not add Codex documentation to a Claude-only install', async () => {
    await installFlow('inferno', ['claude']);
    expect(existsSync('.specsmd/inferno/README.md')).toBe(true);
    expect(existsSync('.specsmd/inferno/README.codex.md')).toBe(false);
  });
});
