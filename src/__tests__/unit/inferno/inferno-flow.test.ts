/**
 * Unit tests for the INFERNO flow packaging invariants.
 *
 * Guards:
 * - The `inferno-builder` command body stays byte-identical to the canonical
 *   `builder` agent body. The installer materializes the command into the
 *   user's `.claude/agents/specsmd-inferno-builder.md`, which serves as the
 *   builder subagent's system prompt, so any drift would ship a stale prompt.
 * - The two self-contained flow test scripts keep passing from the packaged
 *   source.
 * - The INFERNO tree never references the FIRE artifact namespace.
 * - The flow is registered in FLOWS.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? content.slice(match[0].length) : content).trim();
}

describe('inferno flow', () => {
  it('inferno-builder command body is identical to the canonical builder agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-builder.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it.each([
    'agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs',
    'agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs',
  ])('flow script suite %s passes', (rel) => {
    // throws (and fails the test) on non-zero exit
    execFileSync(process.execPath, [path.join(INFERNO, rel)], { stdio: 'pipe' });
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

  it('FLOWS registers inferno', () => {
    const constants = readFileSync(path.join(ROOT, 'lib/constants.js'), 'utf8');
    expect(constants).toMatch(/inferno:\s*\{[\s\S]*?path:\s*'inferno'/);
  });
});
