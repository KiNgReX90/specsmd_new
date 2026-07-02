/**
 * Unit tests for the aidlc-turbo flow packaging invariants.
 *
 * aidlc-turbo is a slim fork of aidlc: lean inception (requirements +
 * decisions-and-gates ledger + stories, no ceremony) and story-driven
 * construction (no bolts). These guards keep the fork coherent:
 * - The flow is registered in FLOWS with path 'aidlc-turbo'.
 * - The four phase commands exist under the renamed names that drive the
 *   `/specsmd-aidlc-turbo*` slash commands.
 * - The tree uses its own `.specs-aidlc-turbo/` artifact namespace and the
 *   `.specsmd/aidlc-turbo/` resource path — never the parent aidlc ones.
 * - No stale `/specsmd-*-agent` slash commands survive the rename.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const FLOW = path.join(ROOT, 'flows/aidlc-turbo');

function treeTextFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => /\.(md|cjs|yaml|yml|hbs)$/.test(f));
}

describe('aidlc-turbo flow', () => {
  it('FLOWS registers aidlc-turbo', () => {
    const constants = readFileSync(path.join(ROOT, 'lib/constants.js'), 'utf8');
    expect(constants).toMatch(/'aidlc-turbo':\s*\{[\s\S]*?path:\s*'aidlc-turbo'/);
  });

  it.each([
    'commands/aidlc-turbo.md',
    'commands/aidlc-turbo-inception.md',
    'commands/aidlc-turbo-construction.md',
    'commands/aidlc-turbo-operations.md',
  ])('phase command %s exists', (rel) => {
    expect(existsSync(path.join(FLOW, rel))).toBe(true);
  });

  it('uses its own .specs-aidlc-turbo/ namespace, never the parent memory-bank/ path', () => {
    const offenders = treeTextFiles(FLOW).filter((f) =>
      readFileSync(path.join(FLOW, f), 'utf8').includes('memory-bank/'),
    );
    expect(offenders).toEqual([]);
  });

  it('uses the .specsmd/aidlc-turbo/ resource path, never .specsmd/aidlc/', () => {
    const offenders = treeTextFiles(FLOW).filter((f) =>
      /\.specsmd\/aidlc(?!-light)\//.test(readFileSync(path.join(FLOW, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('no stale /specsmd-*-agent slash commands survive the rename', () => {
    const offenders = treeTextFiles(FLOW).filter((f) =>
      /\/specsmd-(master|inception|construction|operations)-agent/.test(
        readFileSync(path.join(FLOW, f), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
