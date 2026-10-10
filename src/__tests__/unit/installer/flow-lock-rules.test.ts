import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { LOCK, SRC, openSandbox, readLock } from './sandbox';

const { installFlow } = require('../../../lib/installer');

// A rule that holds back work completed without it starts per host, at the install that
// first carried it. The lock records that moment and every later install keeps it.
describe.sequential('flow.lock rule cutover', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => {
    box = openSandbox('specsmd-flow-rules-');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  it('declares the review rule in the flow source', () => {
    const declared = JSON.parse(readFileSync(path.join(SRC, 'flows/inferno/flow-rules.json'), 'utf8'));
    expect(declared.rules).toContain('review');
  });

  it('declares the triage rule and records its start beside the review rule', async () => {
    const declared = JSON.parse(readFileSync(path.join(SRC, 'flows/inferno/flow-rules.json'), 'utf8'));
    expect(declared.rules).toContain('triage');

    await installFlow('inferno', ['claude']);
    const lock = readLock();
    lock.rules = { review: '2026-01-02T03:04:05.000Z' };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2));
    const before = Date.now();
    await installFlow('inferno', ['claude']);

    expect(readLock().rules.review).toBe('2026-01-02T03:04:05.000Z');
    expect(Date.parse(readLock().rules.triage)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('records the install time of every declared rule on the first install', async () => {
    const before = Date.now();
    await installFlow('inferno', ['claude']);
    const since = Date.parse(readLock().rules.review);
    expect(since).toBeGreaterThanOrEqual(before - 1000);
    expect(since).toBeLessThanOrEqual(Date.now());
  });

  it('carries a recorded rule time forward unchanged on every later install', async () => {
    await installFlow('inferno', ['claude']);
    const lock = readLock();
    lock.rules.review = '2026-01-02T03:04:05.000Z';
    writeFileSync(LOCK, JSON.stringify(lock, null, 2));

    await installFlow('inferno', ['claude']);

    expect(readLock().rules.review).toBe('2026-01-02T03:04:05.000Z');
  });

  it('sets the time for a rule the previous lock did not carry yet', async () => {
    await installFlow('inferno', ['claude']);
    const lock = readLock();
    delete lock.rules;
    writeFileSync(LOCK, JSON.stringify(lock, null, 2));

    const before = Date.now();
    await installFlow('inferno', ['claude']);

    expect(Date.parse(readLock().rules.review)).toBeGreaterThanOrEqual(before - 1000);
  });
});
