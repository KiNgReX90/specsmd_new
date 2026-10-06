import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { budgetStub, openSandbox, readLock, snapshot, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');

const CODEX_CONFIG = '.specs-inferno/config.codex.yaml';
const WRITTEN_BEFORE_THE_KEY = '# The Codex host config.\n\nautonomy:\n  level: full\n\nroles:\n  builder_strong:\n    agent: specsmd_inferno_builder_strong\n';

// The run scripts read a config with no `host` key as a Claude host's, so a Codex config
// written before the key existed would print Claude agent names on the Codex fleet. An
// install carrying the codex tool declares the host in that config.
describe.sequential('the Codex host config declares its host', () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => {
    box = openSandbox('specsmd-host-config-');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  it('adds host: codex above the first key of a Codex config written before the key', async () => {
    write(CODEX_CONFIG, WRITTEN_BEFORE_THE_KEY);

    await installFlow('inferno', ['codex']);

    expect(readFileSync(CODEX_CONFIG, 'utf8')).toBe(
      WRITTEN_BEFORE_THE_KEY.replace('\nautonomy:', '\nhost: codex\n\nautonomy:'),
    );
    expect(readLock().files[CODEX_CONFIG]).toBeUndefined();
  });

  it('leaves a config that declares its own host as it is', async () => {
    const declared = `host: codex\n${WRITTEN_BEFORE_THE_KEY}`;
    write(CODEX_CONFIG, declared);

    await installFlow('inferno', ['codex']);

    expect(readFileSync(CODEX_CONFIG, 'utf8')).toBe(declared);
  });

  it('writes no config on a host that has none, and none on an install without the codex tool', async () => {
    await installFlow('inferno', ['codex']);
    expect(existsSync(CODEX_CONFIG)).toBe(false);

    write(CODEX_CONFIG, WRITTEN_BEFORE_THE_KEY);
    await installFlow('inferno', ['claude']);
    expect(readFileSync(CODEX_CONFIG, 'utf8')).toBe(WRITTEN_BEFORE_THE_KEY);
  });

  it('puts the config back when the install fails', async () => {
    write(CODEX_CONFIG, WRITTEN_BEFORE_THE_KEY);
    const before = snapshot(box.root);
    budgetStub(path.join(box.data, 'specsmd-inferno/flow-text-budget.py'), 1, 'planner 4501/4500 words');

    await expect(installFlow('inferno', ['codex'])).rejects.toThrow(/planner 4501\/4500 words/);

    expect(snapshot(box.root)).toEqual(before);
  });
});
