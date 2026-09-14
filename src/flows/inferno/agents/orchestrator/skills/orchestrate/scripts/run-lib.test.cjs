const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const lib = require("./run-lib.cjs");

function tempdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The assertions about one host project's own `.specs-inferno/config.yaml` (its
// finalize commands, its finalize_scopes globs, no per-item browser run) name
// that project's scripts and live in that repo's copy of this suite. This is the
// flow source, which ships into any project, so it asserts only the library.

// --- a work item's finalize_check reaching the shell ------------------------

const CHECK = '"test -z \\"$(grep -n forbidden-literal fixture.txt)\\""';

/** A work-item spec the way the planner's template renders one. */
function itemSpec(check) {
  return `---
id: probe
title: "Probe"
intent: demo
kind: behavior
complexity: low
status: pending
depends_on: []
---

# Work Item: probe

## Execution Manifest

context:
  required:
    - path: fixture.txt
      reason: the file the check reads
ownership:
  editable:
    - fixture.txt
finalize_check: ${check}

## Technical Notes

(none)
`;
}

/** A git-free tree holding the item and the fixture its check greps. */
function probeTree(literalPresent) {
  const dir = tempdir("inferno-lib-check-");
  const spec = path.join(dir, ".specs-inferno", "intents", "demo", "work-items", "probe.md");
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, itemSpec(CHECK), "utf8");
  fs.writeFileSync(path.join(dir, "fixture.txt"), literalPresent ? "keep\nforbidden-literal\n" : "keep\nallowed\n", "utf8");
  return dir;
}

/** wrap: false keeps the run off the machine's build wrapper, which queues on a lock. */
function check(dir) {
  const spec = lib.readItemSpec(dir, "demo", "probe");
  return {
    command: spec.manifest.finalize_check,
    run: lib.runShell(spec.manifest.finalize_check, dir, path.join(dir, "log", "check.log"), { wrap: false }),
  };
}

test("a finalize_check with escaped quotes passes on a tree that meets it", () => {
  const clean = check(probeTree(false));
  assert.equal(clean.command, 'test -z "$(grep -n forbidden-literal fixture.txt)"');
  assert.equal(clean.run.code, 0);
});

test("the same finalize_check fails on a tree that carries the forbidden literal", () => {
  const dirty = check(probeTree(true));
  assert.notEqual(dirty.run.code, 0);
});

// --- git's own quoting -----------------------------------------------------

test("a path git quoted with its C escapes loses the quotes and keeps its bytes", () => {
  const dir = tempdir("inferno-lib-status-");
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: ["ignore", "pipe", "pipe"] });
  fs.writeFileSync(path.join(dir, "caf\u00e9.txt"), "x\n", "utf8");

  const paths = lib.statusPaths(dir);
  assert.equal(paths.length, 1);
  assert.ok(paths[0].startsWith("caf"), `expected the quoted path, got ${paths[0]}`);
  assert.ok(!paths[0].startsWith('"'), `expected the quotes gone, got ${paths[0]}`);
});

// --- the config shape ------------------------------------------------------

test("selected host config inherits only missing project-wide sections", () => {
  const dir = tempdir("inferno-lib-host-config-");
  const configDir = path.join(dir, ".specs-inferno");
  fs.mkdirSync(configDir);
  fs.writeFileSync(
    path.join(configDir, "config.yaml"),
    `verification:
  finalize:
    - echo default
  integrate:
    - echo default integrate
worktree:
  bootstrap:
    - echo default bootstrap
  preserve: true
recovery:
  idle_minutes: 45
halt:
  flag_file: .specs-inferno/halt.yaml
delivery:
  base_branch: default
`,
    "utf8",
  );
  const selectedFile = path.join(configDir, "config.codex.yaml");
  fs.writeFileSync(
    selectedFile,
    `verification:
  finalize:
    - echo host
delivery:
  base_branch: host
`,
    "utf8",
  );

  const selected = lib.readConfig(dir, ".specs-inferno/config.codex.yaml");
  assert.deepEqual(selected.verification, { finalize: ["echo host"] });
  assert.deepEqual(selected.worktree, {
    bootstrap: ["echo default bootstrap"],
    preserve: "true",
  });
  assert.deepEqual(selected.recovery, { idle_minutes: "45" });
  assert.deepEqual(selected.halt, { flag_file: ".specs-inferno/halt.yaml" });
  assert.deepEqual(selected.delivery, { base_branch: "host" });

  fs.writeFileSync(
    selectedFile,
    `verification:
  finalize:
    - echo host
worktree:
  bootstrap: []
delivery:
  base_branch: host
`,
    "utf8",
  );
  const explicit = lib.readConfig(dir, ".specs-inferno/config.codex.yaml");
  assert.deepEqual(explicit.worktree, { bootstrap: [] });

  fs.writeFileSync(
    selectedFile,
    `autonomy:
  mode: autopilot
`,
    "utf8",
  );
  const hostOnly = lib.readConfig(dir, ".specs-inferno/config.codex.yaml");
  assert.equal(hostOnly.verification, undefined);
  assert.equal(hostOnly.delivery, undefined);
  assert.deepEqual(hostOnly.worktree, {
    bootstrap: ["echo default bootstrap"],
    preserve: "true",
  });
});

test("a verification block that is not a map of command lists is refused with the reason", () => {
  const dir = tempdir("inferno-lib-badconfig-");
  fs.mkdirSync(path.join(dir, ".specs-inferno"));
  fs.writeFileSync(path.join(dir, ".specs-inferno", "config.yaml"), "verification: yes\n", "utf8");

  assert.throws(
    () => lib.readConfig(dir),
    (error) => {
      assert.equal(error.code, "BAD_CONFIG");
      assert.match(error.message, /verification/);
      return true;
    },
  );
});

test("an integrate list holding something other than commands is refused", () => {
  const dir = tempdir("inferno-lib-badlist-");
  fs.mkdirSync(path.join(dir, ".specs-inferno"));
  fs.writeFileSync(
    path.join(dir, ".specs-inferno", "config.yaml"),
    "verification:\n  integrate: npm test\n",
    "utf8",
  );

  assert.throws(() => lib.readConfig(dir), (error) => error.code === "BAD_CONFIG");
});

test('native integration verification uses the build wrapper', (t) => {
  const dir = tempdir('inferno-lib-cap-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wrapper = path.join(dir, 'claude-build');
  fs.writeFileSync(wrapper, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  fs.chmodSync(wrapper, 0o755);
  const original = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${original}`;
  t.after(() => { process.env.PATH = original; });
  for (const command of ['npm run verify:integration', 'node verify-integration.mjs']) {
    assert.equal(lib.isHeavy(command), true);
    const log = path.join(dir, 'wrapped.log');
    const result = lib.runShell(command, dir, log);
    assert.equal(result.wrapped, true);
    assert.equal(result.code, 0);
    assert.ok(fs.readFileSync(log, 'utf8').includes(`--\nbash\n-c\n${command}\n`));
  }
  assert.equal(lib.isHeavy('npm run check:secrets'), false);
});

test('the shell builtin test is a probe, never a heavy command for the wrapper queue', () => {
  // A probe like `test -f src/a.ts` is a shell builtin; wrapping it makes every probe wait
  // behind whatever cargo build holds the machine lock.
  assert.equal(lib.isHeavy('test -f src/a.ts'), false);
  assert.equal(lib.isHeavy('test -f src/board/tile.ts && echo yes'), false);
  assert.equal(lib.isHeavy('[ -e dist/app.js ]'), false);
  assert.equal(lib.isHeavy('npm test'), true);
  assert.equal(lib.isHeavy('cargo test --lib mcp::tools'), true);
  assert.equal(lib.isHeavy('node --test scripts/x.test.mjs'), true);
  assert.equal(lib.isHeavy('test -f src/a.ts && npm run build'), true);
});
