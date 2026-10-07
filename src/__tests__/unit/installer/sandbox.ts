import { mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

// Tests never call mkdtemp directly; the flow's temp helper owns every test dir.
const { tempDir } = require('../../../flows/inferno/agents/orchestrator/skills/orchestrate/scripts/test-temp.cjs');

export const SRC = path.resolve(__dirname, '../../..');
export const LOCK = '.specsmd/inferno/flow.lock';

const ENV_KEYS = ['INFERNO_FLOW_BUDGET', 'XDG_DATA_HOME', 'DO_NOT_TRACK'];

/**
 * A temporary host root with cwd moved into it and the budget lookup pointed at an
 * empty data dir, so no machine-level budget script ever runs against a test host.
 */
export function openSandbox(prefix: string) {
  const originalCwd = process.cwd();
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const base = tempDir(prefix);
  const root = path.join(base, 'host');
  const data = path.join(base, 'data');
  mkdirSync(root);
  mkdirSync(data);
  delete process.env.INFERNO_FLOW_BUDGET;
  process.env.XDG_DATA_HOME = data;
  process.env.DO_NOT_TRACK = '1';
  process.chdir(root);
  return {
    base,
    root,
    data,
    close() {
      process.chdir(originalCwd);
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export function write(rel: string, content: string) {
  mkdirSync(path.dirname(rel), { recursive: true });
  writeFileSync(rel, content);
}

export function sha256(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

export function readLock() {
  return JSON.parse(readFileSync(LOCK, 'utf8'));
}

/** Every file, symlink and directory under root, with file contents, for before and after comparison. */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) out[rel] = `link:${readlinkSync(abs)}`;
      else if (stat.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(abs);
      } else out[rel] = readFileSync(abs, 'utf8');
    }
  };
  walk(root);
  return out;
}

/** A budget stub that records its arguments and exits with the given status. */
export function budgetStub(file: string, status: number, output: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      'import sys',
      `open(${JSON.stringify(`${file}.args`)}, "w").write("\\n".join(sys.argv[1:]))`,
      `print(${JSON.stringify(output)})`,
      `sys.exit(${status})`,
      '',
    ].join('\n')
  );
  return file;
}
