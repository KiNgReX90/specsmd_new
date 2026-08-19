/**
 * Unit tests for the INFERNO flow packaging invariants.
 *
 * Guards:
 * - Claude wrappers keep the requested model matrix and byte-identical worker
 *   procedures across command, installed-agent, and strong/cheap variants.
 * - The self-contained flow test scripts keep passing from the packaged
 *   source.
 * - The INFERNO tree never references the FIRE artifact namespace.
 * - The flow is registered in FLOWS.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { builtinModules } from 'module';
import path from 'path';

const isBuiltin = (id: string) => builtinModules.includes(id);

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? content.slice(match[0].length) : content).trim();
}

function frontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

describe('inferno flow', () => {
  it('inferno-builder command body is identical to the canonical builder agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-builder.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it('cheap builder wrappers duplicate the strong builder procedure exactly', () => {
    const strongCommand = readFileSync(path.join(INFERNO, 'commands/inferno-builder.md'), 'utf8');
    const cheapCommand = readFileSync(path.join(INFERNO, 'commands/inferno-builder-cheap.md'), 'utf8');
    const strongAgent = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    const cheapAgent = readFileSync(path.join(INFERNO, 'agents/builder-cheap/agent.md'), 'utf8');
    expect(stripFrontmatter(cheapCommand)).toBe(stripFrontmatter(strongCommand));
    expect(stripFrontmatter(cheapAgent)).toBe(stripFrontmatter(strongAgent));
    expect(stripFrontmatter(cheapCommand)).toBe(stripFrontmatter(cheapAgent));
  });

  it('inferno-writer command body is identical to the canonical writer agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-writer.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/writer/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it.each([
    ['commands/inferno.md', 'claude-opus-5', 'xhigh'],
    ['commands/inferno-planner.md', 'claude-opus-5', 'xhigh'],
    ['commands/inferno-builder.md', 'claude-opus-5', 'xhigh'],
    ['commands/inferno-builder-cheap.md', 'claude-sonnet-4-6', 'high'],
    ['commands/inferno-config.md', 'claude-sonnet-4-6', 'high'],
    ['commands/inferno-writer.md', 'claude-sonnet-4-6', 'high'],
    ['agents/orchestrator/agent.md', 'claude-opus-5', 'xhigh'],
    ['agents/planner/agent.md', 'claude-opus-5', 'xhigh'],
    ['agents/builder/agent.md', 'claude-opus-5', 'xhigh'],
    ['agents/builder-cheap/agent.md', 'claude-sonnet-4-6', 'high'],
    ['agents/writer/agent.md', 'claude-sonnet-4-6', 'high'],
  ])('%s pins model %s at effort %s', (rel, model, level) => {
    const fm = frontmatter(readFileSync(path.join(INFERNO, rel), 'utf8'));
    expect(fm).toMatch(new RegExp(`^model:\\s*${model}\\s*$`, 'm'));
    expect(fm).toMatch(new RegExp(`^effort:\\s*${level}\\s*$`, 'm'));
  });

  it('Claude config defaults use only the requested exact model IDs', () => {
    const config = readFileSync(
      path.join(INFERNO, 'agents/orchestrator/config.example.yaml'),
      'utf8'
    );
    expect(config).toMatch(/^\s*strong:\s*claude-opus-5\b/m);
    expect(config).toMatch(/^\s*cheap:\s*claude-sonnet-4-6\b/m);
    expect(config).toMatch(/^\s*writer:\s*claude-sonnet-4-6\b/m);
    expect(config).not.toMatch(/gpt[- ]?5(?:\.| )?5|gpt-5\.6/i);
  });

  it.each([
    'agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs',
    'agents/orchestrator/skills/orchestrate/scripts/state-transition.test.cjs',
    'agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs',
  ])('flow script suite %s passes', (rel) => {
    // throws (and fails the test) on non-zero exit
    execFileSync(process.execPath, [path.join(INFERNO, rel)], { stdio: 'pipe' });
  });

  // The flow's scripts execute inside consumer projects (Rust apps, static sites) that have
  // no node_modules, so a single `require('yaml')` would make the script throw at the exact
  // moment it is meant to save the ledger. Node builtins only.
  it.each([
    'agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs',
    'agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs',
  ])('%s requires nothing outside the Node stdlib', (rel) => {
    const source = readFileSync(path.join(INFERNO, rel), 'utf8');
    const required = [...source.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    const external = required.filter(
      (id) => !id.startsWith('.') && !isBuiltin(id.replace(/^node:/, ''))
    );
    expect(external).toEqual([]);
  });

  it('inferno tree never references the FIRE artifact namespace', () => {
    const files = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((f) => /\.(md|cjs|yaml|yml|hbs)$/.test(f));
    const offenders = files.filter((f) => {
      const c = readFileSync(path.join(INFERNO, f), 'utf8');
      return c.includes('.specs-fire') || c.includes('.specsmd/fire');
    });
    expect(offenders).toEqual([]);
  });

  it('the shipped INFERNO source contains no obsolete GPT-5.5 setting', () => {
    const files = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((file) => /\.(md|toml|yaml|yml)$/.test(file));
    const offenders = files.filter((file) =>
      /gpt[- ]?5(?:\.| )?5/i.test(readFileSync(path.join(INFERNO, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('FLOWS registers inferno', () => {
    const constants = readFileSync(path.join(ROOT, 'lib/constants.js'), 'utf8');
    expect(constants).toMatch(/inferno:\s*\{[\s\S]*?path:\s*'inferno'/);
  });
});
