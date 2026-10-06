const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { reviewed } = require("./review-fixture.cjs");
const { CONFIG, ITEMS, STATE, git, item, opened, repo, run, write } = require("./run-fixture.cjs");

// --- integrate -----------------------------------------------------------
// The cheap checks run after every item lands, on the committed tree with the base folded in,
// so a builder that broke them is corrected warm and the gate keeps only the suites worth
// running once (2026-09-06).
const INTEGRATE = CONFIG.replace("  finalize_scopes:", "  integrate:\n    - echo integrate ran\n  finalize_scopes:");

test("integrate folds the base in and runs the integrate list on the landed tree", () => {
  const fixture = repo({ config: INTEGRATE });
  const { tree } = opened(fixture);
  write(fixture.root, "src/c.ts", "export const c = 3;\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved"]);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  const result = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /folded main into/);
  assert.match(result.out, /PASS \d+s echo integrate ran/);
  assert.ok(fs.existsSync(path.join(tree, "src/c.ts")), "the fold brought main's file in");
});

// The cargo tree was left out of the integrate list for cost, and an item merged eight broken
// Rust cases through a green integrate (2026-09-10). Scoped the way the gate scopes it, a
// command costs nothing on a branch that never touched its paths.
test("integrate skips a scoped command the branch never reached, and runs it once the branch does", () => {
  const config = INTEGRATE.replace("    - echo integrate ran", "    - echo integrate ran\n    - echo scoped");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  const untouched = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(untouched.code, 0, untouched.out + untouched.err);
  assert.match(untouched.out, /SKIP echo scoped \(no path in scope changed\)/);
  write(tree, "docs/b.md", "docs moved\n");
  git(tree, ["commit", "-qam", "docs landed"]);
  const reached = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(reached.code, 0, reached.out + reached.err);
  assert.match(reached.out, /PASS \d+s echo scoped/);
});

test("integrate stops at the first failing command and points at its log", () => {
  const config = INTEGRATE.replace("    - echo integrate ran", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out, /FAIL/);
  assert.match(result.out, /the reason/);
  const log = /-> (\S+)/.exec(result.out)[1];
  assert.match(log, /integrate-/);
});

test("integrate refuses a dirty tree and folds only when the config lists nothing", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 5;\n");
  assert.equal(run(fixture, ["integrate", "--tree", tree]).code, 2);
  git(tree, ["commit", "-qam", "landed"]);
  const result = run(fixture, ["integrate", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /no verification.integrate list/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3, "integrate never writes the green marker");
});

// --- integrate completes the item ----------------------------------------
// Completion is what integrate says once the checks are green. An item marked completed
// and then interrupted used to release its successor on the next run, on a tree nothing
// had verified (2026-09-09).

test("integrate --item completes the item with the sha its checks proved", () => {
  const fixture = repo({ config: INTEGRATE });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  reviewed(run, fixture, tree, ["a-one"]);
  const proved = git(tree, ["rev-parse", "--short", "HEAD"]).trim();

  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /completed a-one/);
  const ledger = fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8");
  assert.match(ledger, new RegExp(`integrated_sha: ${proved}`));
  assert.equal(git(tree, ["status", "--porcelain"]).trim(), "", "integrate commits the ledger it wrote");
  const frontier = JSON.parse(run(fixture, ["frontier", "alpha", "--tree", tree, "--json"]).out);
  assert.deepEqual(frontier.ready.map((entry) => entry.id), ["a-two"]);
});

// A completed item is never re-validated and never re-dispatched, whatever its proof. It is
// held: its successors wait until an integration proves the tree it landed on.
const INTERRUPTED = STATE.replace(
  /(- id: a-one[\s\S]*?)status: pending/,
  "$1status: completed\n        completed_at: 2026-09-10T09:00:00Z",
);

test("a completed item with no integration proof holds its successor and asks for the proof", () => {
  const fixture = repo({ state: INTERRUPTED });
  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /HELD a-one: completed with no integration proof/);
  assert.match(result.out, /run\.cjs integrate --item a-one --tree/);
  const payload = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(payload.ready.map((entry) => entry.id), []);
  assert.deepEqual(payload.waiting.map((entry) => entry.id), ["a-two"]);
  assert.deepEqual(payload.held, ["a-one"]);
});

test("a completed item is never re-validated, so a path it deleted is not an error", () => {
  const items = {
    ...ITEMS,
    "alpha/a-one": item({ id: "a-one", intent: "alpha", required: ["src/deleted-by-a-one.ts"] }),
  };
  const fixture = repo({ state: INTERRUPTED, items });

  assert.equal(run(fixture, ["frontier", "alpha"]).code, 3, "held, not INVALID");
  assert.doesNotMatch(run(fixture, ["frontier", "alpha"]).out, /INVALID/);
});

// Every ledger the old flow wrote carries completed items and no proof at all. The old
// integrate ran the same checks and recorded nothing, so those count as proved.
const LEGACY = `project:
  name: demo
intents:
  - id: alpha
    title: "Alpha"
    status: in_progress
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: a-one
        title: "A one"
        kind: behavior
        complexity: low
        status: completed
        completed_at: 2026-09-08T10:00:00Z
        depends_on: []
      - id: a-two
        title: "A two"
        kind: behavior
        complexity: medium
        status: completed
        completed_at: 2026-09-09T07:30:00Z
        depends_on: [a-one]
`;

test("a ledger the old flow completed leaves an empty frontier, not a validation error", () => {
  const items = {
    ...ITEMS,
    "alpha/a-one": item({ id: "a-one", intent: "alpha", required: ["src/routes/dossier/+page.svelte"] }),
  };
  const fixture = repo({ state: LEGACY, items });

  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /no item left in this intent/);
  assert.doesNotMatch(result.out, /INVALID/);
  assert.doesNotMatch(result.out, /HELD/);
});

test("an item the integration proved releases its successor", () => {
  const proved = STATE.replace(
    /(- id: a-one[\s\S]*?)status: pending/,
    "$1status: completed\n        completed_at: 2026-09-10T09:00:00Z\n        integrated_sha: abc1234",
  );
  const fixture = repo({ state: proved });
  const result = run(fixture, ["frontier", "alpha", "--json"]);

  assert.equal(result.code, 0, result.out);
  assert.deepEqual(JSON.parse(result.out).ready.map((entry) => entry.id), ["a-two"]);
});

// --- the browser journeys this landing can break -------------------------
// A config with no `integrate_e2e` section runs no browser step, which is the shape both of
// this repo's host configs carry since 2026-09-11: the selection cost as much as the whole
// suite and the finalize gate reran the whole suite anyway, because a proof is keyed on the
// command string.
test("integrate runs no browser step when the config declares no integrate_e2e", () => {
  const fixture = repo({ config: INTEGRATE });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);

  reviewed(run, fixture, tree, ["a-one"]);
  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one", "--json"]);

  assert.equal(result.code, 0, result.out + result.err);
  const payload = JSON.parse(result.out);
  assert.deepEqual(
    payload.results.map(({ command, result }) => ({ command, result })),
    [{ command: "echo integrate ran", result: "pass" }],
  );
  assert.deepEqual(payload.items, ["a-one"]);
  assert.match(fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8"), /integrated_sha/);
});

// integrate ran the cheap checks only, so twenty e2e cases went red at item one of an intent
// and stayed red through item five, met hours later at the finalize gate (2026-09-09).
const E2E = INTEGRATE.replace(
  "  finalize_scopes:",
  `  integrate_e2e:
    command: echo ran
    full: echo the whole suite
    exempt:
      - "**/*.test.ts"
    full_when:
      - "src/**"
    map:
      "src/a.ts": ["e2e/a.spec.ts"]
      "src/c.ts": ["e2e/c.spec.ts"]
  finalize_scopes:`,
);

test("integrate runs the specs the landed source maps to", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);

  reviewed(run, fixture, tree, ["a-one"]);
  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo ran e2e\/a\.spec\.ts/);
});

test("integrate excludes a change the fold brought in from the base", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(fixture.root, "src/c.ts", "export const c = 3;\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved under the intent"]);
  write(tree, "docs/b.md", "docs only\n");
  git(tree, ["commit", "-qam", "b-one landed"]);

  const result = run(fixture, ["integrate", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP e2e \(nothing browser-facing changed\. Base fold paths are excluded\.\)/);
  assert.doesNotMatch(result.out, /echo ran e2e\/c\.spec\.ts/);
});

test("integrate falls back to the whole suite for a source no entry covers", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(tree, "src/b.ts", "export const b = 9;\n");
  git(tree, ["commit", "-qam", "an unmapped source landed"]);

  const result = run(fixture, ["integrate", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo the whole suite/);
});

test("integrate runs no browser journey for a docs-only landing", () => {
  const fixture = repo({ config: E2E });
  const { tree } = opened(fixture);
  write(tree, "docs/b.md", "docs only\n");
  git(tree, ["commit", "-qam", "docs landed"]);

  const result = run(fixture, ["integrate", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP e2e \(nothing browser-facing changed\. Base fold paths are excluded\.\)/);
});

test("a red e2e run stops the item short of completion", () => {
  const config = E2E.replace("    command: echo ran", "    command: false");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);

  reviewed(run, fixture, tree, ["a-one"]);
  const result = run(fixture, ["integrate", "--tree", tree, "--item", "a-one"]);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /FAIL \d+s false e2e\/a\.spec\.ts/);
  assert.doesNotMatch(fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8"), /integrated_sha/);
});
