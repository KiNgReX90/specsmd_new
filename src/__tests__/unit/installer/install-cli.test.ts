import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { LOCK, SRC, openSandbox, write } from './sandbox';

const CLI = path.join(SRC, 'bin/cli.js');
const COMMAND = '.claude/commands/specsmd-inferno.md';

function env(extra: Record<string, string | undefined> = {}) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (value !== undefined) out[key] = value;
  }
  for (const key of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'SPECSMD_TELEMETRY_DISABLED']) {
    if (!(key in extra)) delete out[key];
  }
  return out;
}

describe.sequential('scriptable install', () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => { box = openSandbox('specsmd-install-cli-'); });
  afterEach(() => { box.close(); });

  function cli(args: string[], extra: Record<string, string | undefined> = {}) {
    return spawnSync(process.execPath, [CLI, ...args], { cwd: box.root, env: env(extra), encoding: 'utf8' });
  }

  it('installs without prompts from flags', () => {
    const run = cli(['install', '--flow', 'inferno', '--tools', 'claude,codex']);
    expect(run.status, run.stderr + run.stdout).toBe(0);
    expect(existsSync(path.join(box.root, LOCK))).toBe(true);
    expect(existsSync(path.join(box.root, '.codex/agents/specsmd_inferno_builder_strong.toml'))).toBe(true);
  });

  it('exits non-zero naming a host edit, and installs over it with --force', () => {
    expect(cli(['install', '--flow', 'inferno', '--tools', 'claude']).status).toBe(0);
    write(COMMAND, 'host edit\n');

    const refused = cli(['install', '--flow', 'inferno', '--tools', 'claude']);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout + refused.stderr).toContain(COMMAND);
    expect(readFileSync(COMMAND, 'utf8')).toBe('host edit\n');

    const forced = cli(['install', '--flow', 'inferno', '--tools', 'claude', '--force']);
    expect(forced.status, forced.stderr + forced.stdout).toBe(0);
    expect(readFileSync(COMMAND, 'utf8')).not.toBe('host edit\n');
  });

  it('refuses an unknown flow or tool without installing anything', () => {
    expect(cli(['install', '--flow', 'nope', '--tools', 'claude']).status).not.toBe(0);
    expect(cli(['install', '--flow', 'inferno', '--tools', 'claude,nope']).status).not.toBe(0);
    expect(cli(['install', '--flow', 'inferno']).status).not.toBe(0);
    expect(existsSync(path.join(box.root, '.specsmd'))).toBe(false);
  });

  it('loads no telemetry client when DO_NOT_TRACK=1', () => {
    const marker = path.join(box.base, 'telemetry');
    const preload = path.join(box.base, 'fake-telemetry.cjs');
    writeFileSync(preload, [
      "const Module = require('module');",
      'const load = Module._load;',
      'Module._load = function (request, ...rest) {',
      "  if (request === 'mixpanel') {",
      `    require('fs').appendFileSync(${JSON.stringify(marker)}, 'loaded\\n');`,
      '    return { init: () => ({ track: (_e, _p, cb) => cb && cb() }) };',
      '  }',
      '  return load.call(this, request, ...rest);',
      '};',
      '',
    ].join('\n'));
    const options = `--require ${preload}`;

    // The instrument: without the opt-out the fake client is loaded.
    expect(cli(['install', '--flow', 'inferno', '--tools', 'claude'], { DO_NOT_TRACK: undefined, NODE_OPTIONS: options }).status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    expect(cli(['install', '--flow', 'inferno', '--tools', 'claude'], { DO_NOT_TRACK: '1', NODE_OPTIONS: options }).status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});

describe.sequential('check-lock.cjs', () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => { box = openSandbox('specsmd-check-lock-'); });
  afterEach(() => { box.close(); });

  function check() {
    return spawnSync(process.execPath, ['.specsmd/inferno/check-lock.cjs'], { cwd: box.root, encoding: 'utf8' });
  }

  it('passes on a clean install and names every changed or missing file', async () => {
    const { installFlow } = require('../../../lib/installer');
    write('AGENTS.md', '# Project rules\n');
    const log = console.log;
    console.log = () => {};
    try {
      await installFlow('inferno', ['claude', 'codex']);
    } finally {
      console.log = log;
    }

    const clean = check();
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);

    write(COMMAND, 'host edit\n');
    rmSync('.specsmd/inferno/README.md');
    writeFileSync('AGENTS.md', readFileSync('AGENTS.md', 'utf8').replace('<!-- specsmd:codex:end -->', 'x\n<!-- specsmd:codex:end -->'));
    writeFileSync('.specsmd/inferno/check-lock.cjs', `${readFileSync('.specsmd/inferno/check-lock.cjs', 'utf8')}\n`);

    const dirty = check();
    expect(dirty.status).not.toBe(0);
    const out = dirty.stdout + dirty.stderr;
    expect(out).toMatch(new RegExp(`changed.*${COMMAND.replace(/\./g, '\\.')}`));
    expect(out).toMatch(/missing.*\.specsmd\/inferno\/README\.md/);
    expect(out).toMatch(/changed.*AGENTS\.md/);
    expect(out).toMatch(/changed.*check-lock\.cjs/);
  });
});
