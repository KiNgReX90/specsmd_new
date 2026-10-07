/**
 * Shared fixture for the run.cjs CLI suites (run*.test.cjs): a throwaway host repo with a bare
 * origin, a ledger and item specs, and a `run` that drives the CLI as a process.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const RUN = path.join(__dirname, "run.cjs");
const WRITER = path.join(__dirname, "state-transition.cjs");
const { LOCK_PATH, codexStub, hostLock, markReviewed, reviewBefore } = require("./review-fixture.cjs");

const STATE = `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: pending
    base_branch: main
    depends_on_intents: [gone-to-archive]
    work_items:
      - id: a-one
        title: "A one"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
      - id: a-two
        title: "A two"
        kind: behavior
        complexity: medium
        status: pending
        depends_on: [a-one]
  - id: beta
    title: "Beta"
    status: pending
    depends_on_intents: [alpha]
    work_items:
      - id: b-one
        title: "B one"
        kind: docs-only
        complexity: low
        status: pending
        depends_on: []
  - id: gamma
    title: "Gamma"
    status: in_progress
    claimed_at: 2026-09-01T00:00:00Z
    claimed_by: inferno-intent/gamma-20260901T000000Z
    depends_on_intents: []
    work_items:
      - id: g-one
        title: "G one"
        status: pending
        depends_on: []
  - id: delta
    title: "Delta"
    status: blocked
    blocked_at: 2026-09-02T00:00:00Z
    blocked_reason: "waits on the recapture the finished application allows"
    depends_on_intents: []
`;

const CONFIG = `models:
  strong: model-strong
  cheap: model-cheap
verification:
  finalize:
    - echo always
    - echo scoped
  finalize_scopes:
    "echo scoped": ["docs/**"]
worktree:
  bootstrap:
    - mkdir -p node_modules && echo ran > node_modules/marker
delivery:
  mode: auto-close
  base_branch: main
`;

/** Render one work-item spec the way the planner's template does. */
function item(spec) {
  const rows = (entries) =>
    (entries || []).map((p) => `    - path: ${p}\n      reason: why ${p}`).join("\n");
  const readRows = (entries) =>
    (entries || [])
      .map(
        (p) =>
          `    - path: ${p}\n      source: the command behind ${p}\n` +
          `      when: at mount and on every arrival\n      stale: the screen keeps a value ${p} moved past`,
      )
      .join("\n");

  return `---
id: ${spec.id}
title: "${spec.id}"
intent: ${spec.intent}
kind: ${spec.kind || "behavior"}
complexity: ${spec.complexity || "low"}
status: pending
depends_on: [${(spec.depends_on || []).join(", ")}]
---

# Work Item: ${spec.id}

## Execution Manifest

context:
  required:
${rows(spec.required || ["src/a.ts"])}
  patterns:
${rows(spec.patterns || ["src/b.ts"])}
  tests:
${rows(spec.tests || ["src/a.test.ts"])}
ownership:
  editable:
${(spec.editable || ["src/a.ts"]).map((p) => `    - ${p}`).join("\n")}
${spec.reads ? `reads:\n${readRows(spec.reads)}` : ""}
${spec.finalize_check ? `finalize_check: ${spec.finalize_check}\n` : ""}
## Technical Notes

(none)
`;
}

const ITEMS = {
  "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: ["src/a.ts"], finalize_check: "test -f src/a.ts" }),
  "alpha/a-two": item({ id: "a-two", intent: "alpha", complexity: "medium", depends_on: ["a-one"], editable: ["src/b.ts"] }),
  "beta/b-one": item({ id: "b-one", intent: "beta", kind: "docs-only", editable: ["docs/b.md"] }),
  "gamma/g-one": item({ id: "g-one", intent: "gamma", editable: ["src/g.ts"] }),
};

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

/** A throwaway repo shaped like a host project: a bare origin, a ledger, item specs. */
function repo(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-run-"));
  const root = path.join(dir, "app");
  const remote = path.join(dir, "remote.git");
  fs.mkdirSync(root, { recursive: true });
  git(dir, ["init", "--bare", "-q", remote]);
  git(dir, ["init", "-q", "-b", "main", root]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);

  write(root, ".gitignore", "node_modules/\n");
  write(root, "src/a.ts", "export const a = 1;\n");
  write(root, "src/b.ts", "export const b = 2;\n");
  write(root, "src/a.test.ts", "// proof\n");
  write(root, "docs/b.md", "docs\n");
  write(root, ".specs-inferno/state.yaml", options.state || STATE);
  // alpha depends on an intent that shipped and archived, which is where a shipped
  // prerequisite answers from.
  write(root, ".specs-inferno/archive/state.yaml", "intents:\n  - id: gone-to-archive\n    status: completed\n");
  write(root, ".specs-inferno/config.yaml", options.config || CONFIG);
  write(root, LOCK_PATH, hostLock());
  for (const [key, body] of Object.entries(options.items || ITEMS)) {
    const [intent, id] = key.split("/");
    write(root, `.specs-inferno/intents/${intent}/work-items/${id}.md`, body);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-qu", "origin", "main"]);
  return { dir, root, remote, cache: path.join(dir, "cache") };
}

/** Drive the CLI the way the orchestrator does: a process, an exit code, stdout. */
function run(fixture, args, options = {}) {
  reviewBefore(args, options.cwd || fixture.root);
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: options.cwd || fixture.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache, SPECSMD_CODEX: codexStub(fixture.cache), ...(options.env || {}) },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

function lines(out) {
  return out.split("\n").filter((line) => line.length > 0);
}

/** Claim alpha and open its worktree; returns the worktree path and branch. */
function opened(fixture) {
  run(fixture, ["claim", "alpha"]);
  const made = JSON.parse(run(fixture, ["worktree", "alpha", "--json"]).out);
  return { tree: made.path, branch: made.branch };
}

// --- ship ----------------------------------------------------------------
/** Take alpha all the way to the state ship expects: closed, archived, gated. */
function closed(fixture) {
  const { tree, branch } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 7;\n");
  git(tree, ["commit", "-qam", "the work"]);
  const state = path.join(tree, ".specs-inferno/state.yaml");
  const proof = git(tree, ["rev-parse", "--short", "HEAD"]).trim();
  markReviewed(state, ["a-one", "a-two"]);
  for (const id of ["a-one", "a-two"]) {
    execFileSync(
      process.execPath,
      [WRITER, "complete-item", "--intent", "alpha", "--item", id, "--file", state, "--proof", proof],
      { cwd: tree },
    );
  }
  execFileSync(process.execPath, [WRITER, "close-intent", "--intent", "alpha", "--file", state], { cwd: tree });
  execFileSync(process.execPath, [WRITER, "archive-intent", "--intent", "alpha", "--file", state], { cwd: tree });
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "specsmd(alpha): close and archive"]);
  return { tree, branch };
}

module.exports = {
  CONFIG,
  ITEMS,
  STATE,
  closed,
  git,
  item,
  lines,
  opened,
  repo,
  run,
  write,
};
