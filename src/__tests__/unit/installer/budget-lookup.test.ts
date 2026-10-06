import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { budgetStub, openSandbox, snapshot, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');

describe.sequential('install budget lookup', () => {
  let box: ReturnType<typeof openSandbox>;
  let logs: string[];
  let savedHome: string | undefined;

  beforeEach(() => {
    box = openSandbox('specsmd-budget-');
    savedHome = process.env.HOME;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.HOME = savedHome;
    box.close();
  });

  it('runs the script config budget.script names, with ~ expanded, ahead of INFERNO_FLOW_BUDGET', async () => {
    process.env.HOME = box.base;
    const configured = budgetStub(path.join(box.base, 'tools/budget.py'), 0, 'within budget');
    const env = budgetStub(path.join(box.base, 'env-budget.py'), 0, 'within budget');
    process.env.INFERNO_FLOW_BUDGET = env;
    write('.specs-inferno/config.yaml', 'budget:\n  script: ~/tools/budget.py\n');

    await installFlow('inferno', ['claude']);

    expect(readFileSync(`${configured}.args`, 'utf8').split('\n')).toEqual(['--repo', box.root, '--quiet']);
    expect(existsSync(`${env}.args`)).toBe(false);
  });

  it('refuses the install and restores the host when the configured script is missing', async () => {
    write('.specs-inferno/config.yaml', 'budget:\n  script: /nowhere/flow-text-budget.py\n');
    const before = snapshot(box.root);

    await expect(installFlow('inferno', ['claude'])).rejects.toThrow(/\/nowhere\/flow-text-budget\.py/);

    expect(snapshot(box.root)).toEqual(before);
  });

  it('says it skipped the budget when no script sits at the unconfigured default', async () => {
    await installFlow('inferno', ['claude']);

    const expected = path.join(box.data, 'specsmd-inferno', 'flow-text-budget.py');
    expect(logs.join('\n')).toContain(`SKIP budget (no script at ${expected})`);
  });
});
