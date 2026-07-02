/**
 * Unit tests for the installer's INFERNO config scaffolding and the per-flow
 * entry-command metadata.
 *
 * The install wizard (src/lib/installer.js) scaffolds .specs-inferno/config.yaml
 * for the INFERNO flow from the prompt answers. `renderInfernoConfig` is the
 * pure answer -> YAML function under test here; the interactive prompting and
 * the file write are exercised end-to-end by evals/install-eval.sh, not here.
 *
 * Schema contract: decisions.md C-3 — top-level `mode`, `models`,
 * `verification`. Mode defaults to production; models default to
 * opus/sonnet/sonnet; verification defaults to the standard build+test list and
 * is omitted entirely when the answer is blank.
 */

import { describe, it, expect } from 'vitest';

// installer.js and constants.js are CommonJS; match the repo's test idiom
// (see __tests__/unit/fire/dashboard-*.test.ts).
const { renderInfernoConfig } = require('../../../lib/installer');
const { FLOWS } = require('../../../lib/constants');
const yaml = require('js-yaml');

describe('renderInfernoConfig', () => {
  it('renders the all-defaults config for empty answers (plain-Enter path)', () => {
    const parsed = yaml.load(renderInfernoConfig({})) as any;
    expect(parsed.mode).toBe('production');
    expect(parsed.models).toEqual({ strong: 'opus', cheap: 'sonnet', writer: 'sonnet' });
    expect(parsed.verification.finalize).toEqual(['npm run build', 'npm test']);
  });

  it('falls back to the same all-defaults config when answers are undefined (abort / non-TTY)', () => {
    const fromUndefined = renderInfernoConfig(undefined);
    const fromEmpty = renderInfernoConfig({});
    expect(fromUndefined).toBe(fromEmpty);
    const parsed = yaml.load(fromUndefined) as any;
    expect(parsed.mode).toBe('production');
    expect(parsed.models).toEqual({ strong: 'opus', cheap: 'sonnet', writer: 'sonnet' });
    expect(parsed.verification.finalize).toEqual(['npm run build', 'npm test']);
  });

  it('honors a mode override', () => {
    const parsed = yaml.load(renderInfernoConfig({ mode: 'autonomous' })) as any;
    expect(parsed.mode).toBe('autonomous');
  });

  it('ignores an unknown mode and keeps production (the safe default)', () => {
    const parsed = yaml.load(renderInfernoConfig({ mode: 'nonsense' })) as any;
    expect(parsed.mode).toBe('production');
  });

  it('honors model-tier overrides', () => {
    const parsed = yaml.load(
      renderInfernoConfig({ strong: 'sonnet', cheap: 'haiku', writer: 'haiku' }),
    ) as any;
    expect(parsed.models).toEqual({ strong: 'sonnet', cheap: 'haiku', writer: 'haiku' });
  });

  it('falls back per-tier when a model answer is blank', () => {
    const parsed = yaml.load(renderInfernoConfig({ strong: '', cheap: 'haiku' })) as any;
    expect(parsed.models).toEqual({ strong: 'opus', cheap: 'haiku', writer: 'sonnet' });
  });

  it('parses comma-separated verification commands (trimming and dropping blanks)', () => {
    const parsed = yaml.load(renderInfernoConfig({ verification: ' lint ,, build , test ' })) as any;
    expect(parsed.verification.finalize).toEqual(['lint', 'build', 'test']);
  });

  it('omits the verification section when the answer is empty', () => {
    const rendered = renderInfernoConfig({ verification: '' });
    // No active top-level verification key (a commented hint may remain).
    expect(rendered).not.toMatch(/^verification:/m);
    const parsed = yaml.load(rendered) as any;
    expect(parsed.verification).toBeUndefined();
  });

  it('produces valid YAML matching the C-3 schema for mixed overrides', () => {
    const parsed = yaml.load(
      renderInfernoConfig({ mode: 'autonomous', strong: 'opus', verification: 'a, b' }),
    ) as any;
    expect(parsed).toMatchObject({
      mode: 'autonomous',
      models: { strong: 'opus', cheap: 'sonnet', writer: 'sonnet' },
      verification: { finalize: ['a', 'b'] },
    });
  });
});

describe('FLOWS entry-command metadata', () => {
  it('every flow declares a non-empty slash entryCommand', () => {
    const entries = Object.entries(FLOWS as Record<string, { entryCommand?: string }>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, flow] of entries) {
      expect(typeof flow.entryCommand).toBe('string');
      expect(flow.entryCommand).toMatch(/^\/specsmd-/);
    }
  });

  it('maps INFERNO to /specsmd-inferno-planner (not the nonexistent master agent)', () => {
    expect(FLOWS.inferno.entryCommand).toBe('/specsmd-inferno-planner');
    expect(FLOWS.inferno.entryCommand).not.toBe('/specsmd-master-agent');
  });

  it('keeps the master-agent command for the classic AI-DLC flow', () => {
    expect(FLOWS.aidlc.entryCommand).toBe('/specsmd-master-agent');
  });
});
