const assert = require("node:assert/strict");
const test = require("node:test");

const { parseYaml } = require("./run-yaml.cjs");
const impact = require("./run-e2e-impact.cjs");

// The section a project keeps beside its integrate list: how to run a selection, the
// conservative arm, what needs no browser run, and which source reaches which journey.
const CONFIG = parseYaml(`verification:
  integrate_e2e:
    command: npx playwright test
    full: npm run test:e2e
    exempt:
      - "**/*.test.ts"
      - "src/lib/i18n/**"
    full_when:
      - "src/**"
      - "e2e/**"
      - "playwright.config.ts"
      - "package-lock.json"
    map:
      "src/lib/dashboard/**": ["e2e/dashboard.spec.ts", "e2e/board-edges.spec.ts"]
      "src/lib/brand/board-fit.css": ["e2e/dashboard.spec.ts"]
      "src/lib/wizard/**": ["e2e/gap-list.spec.ts"]
`);

function select(changed, manifests = []) {
  return impact.select({ changed, manifests, config: CONFIG });
}

test("a shelf css change with no spec edited selects the dashboard spec", () => {
  const result = select(["src/lib/brand/board-fit.css"]);
  assert.equal(result.full, false);
  assert.deepEqual(result.specs, ["e2e/dashboard.spec.ts"]);
  assert.equal(result.command, "npx playwright test e2e/dashboard.spec.ts");
});

test("one invocation carries every spec once, however many files named it", () => {
  const result = select(["src/lib/brand/board-fit.css", "src/lib/dashboard/DocumentShelf.svelte"]);
  assert.deepEqual(result.specs, ["e2e/board-edges.spec.ts", "e2e/dashboard.spec.ts"]);
  assert.equal(result.command, "npx playwright test e2e/board-edges.spec.ts e2e/dashboard.spec.ts");
});

test("the item's own spec targets are selected whether or not a source changed", () => {
  const result = select([], [{ context: { tests: [{ path: "e2e/gap-list.spec.ts" }] }, ownership: { editable: ["e2e/watch-floor.spec.ts", "src/lib/vuln/watch.ts"] } }]);
  assert.deepEqual(result.specs, ["e2e/gap-list.spec.ts", "e2e/watch-floor.spec.ts"]);
});

test("a changed spec runs itself and asks for nothing else", () => {
  const result = select(["e2e/gap-list.spec.ts"]);
  assert.equal(result.full, false);
  assert.deepEqual(result.specs, ["e2e/gap-list.spec.ts"]);
});

test("an unmapped source runs the whole suite, the conservative arm", () => {
  const result = select(["src/lib/wire/enums.ts"]);
  assert.equal(result.full, true);
  assert.equal(result.command, "npm run test:e2e");
  assert.match(result.reason, /src\/lib\/wire\/enums\.ts/);
});

test("a unit test and a catalogue file never buy the whole suite", () => {
  const result = select(["src/lib/dashboard/dashboard.test.ts", "src/lib/i18n/en.dashboard.ts"]);
  assert.equal(result.full, false);
  assert.deepEqual(result.specs, []);
  assert.equal(result.command, null);
});

test("a docs-only change selects nothing", () => {
  const result = select(["docs/WORKING-AGREEMENT.md", ".specs-inferno/state.yaml"]);
  assert.equal(result.full, false);
  assert.equal(result.command, null);
  assert.match(result.reason, /nothing browser-facing/);
});

test("a project with no e2e section selects nothing at all", () => {
  const result = impact.select({ changed: ["src/lib/wire/enums.ts"], manifests: [], config: undefined });
  assert.equal(result.command, null);
  assert.equal(result.full, false);
});

// --- selection over a real git tree ----------------------------------------
// The module keeps working for a project that configures `verification.integrate_e2e`. This
// repo no longer does: the browser suite runs once, at finalize. See .specs-inferno/config.yaml.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const lib = require("./run-lib.cjs");

function repository(t) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-impact-"));
  t.after(() => fs.rmSync(tree, { recursive: true, force: true }));
  const git = (...args) => lib.git(tree, args);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Impact Test");
  git("config", "user.email", "impact@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  const write = (file, content = file) => {
    fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
    fs.writeFileSync(path.join(tree, file), content);
  };
  const commit = (file, content) => {
    write(file, content);
    git("add", "--", file);
    git("commit", "-qm", `change ${file}`);
    return git("rev-parse", "HEAD");
  };
  commit(".specs-inferno/config.yaml", "delivery:\n  base_branch: main\n");
  return { tree, git, write, commit };
}

function previousProof(anchor, proof) {
  return { ledger: { intents: [{ items: [{ id: "previous", integrated_sha: proof }] }] },
    options: { items: ["current"], anchor } };
}

test("a fold-only landing selects no browser run and explains the exclusion", (t) => {
  const { tree, git, commit } = repository(t);
  git("switch", "-qc", "intent");
  const proof = commit("docs/intent.md");
  const anchor = impact.anchorFor(tree, "main");
  git("switch", "-q", "main");
  commit("src/unmapped.ts");
  git("switch", "-q", "intent");
  git("merge", "--no-edit", "main");
  const { ledger, options } = previousProof(anchor, proof);
  const changed = impact.changedSince(tree, impact.sinceRef(tree, ledger, options));
  assert.deepEqual(changed, ["docs/intent.md"]);
  const result = select(changed);
  assert.equal(result.command, null);
  assert.match(result.reason, /Base.*excluded/);
});

test("the whole intent and its working tree count while folded paths do not", (t) => {
  const { tree, git, write, commit } = repository(t);
  git("switch", "-qc", "intent");
  const proof = commit("src/lib/dashboard/first.svelte");
  commit("src/lib/wizard/second.svelte");
  const anchor = impact.anchorFor(tree, "main");
  git("switch", "-q", "main");
  commit("src/unmapped.ts");
  git("switch", "-q", "intent");
  git("merge", "--no-edit", "main");
  write("src/lib/dashboard/first.svelte", "unstaged change");
  write("src/lib/dashboard/staged.svelte");
  git("add", "src/lib/dashboard/staged.svelte");
  write("src/lib/wizard/untracked.svelte");
  const { ledger, options } = previousProof(anchor, proof);
  assert.deepEqual(impact.changedSince(tree, impact.sinceRef(tree, ledger, options)), [
    "src/lib/dashboard/first.svelte", "src/lib/dashboard/staged.svelte",
    "src/lib/wizard/second.svelte", "src/lib/wizard/untracked.svelte",
  ]);
});

test("a dependency lockfile committed by the intent still selects the whole suite", (t) => {
  const { tree, git, commit } = repository(t);
  git("switch", "-qc", "intent");
  commit("package-lock.json", "{}");
  const changed = impact.changedSince(tree, impact.anchorFor(tree, "main"));
  const result = select(changed);
  assert.equal(result.full, true);
  assert.equal(result.command, "npm run test:e2e");
});

test("a folded remote base is excluded when the local base has not advanced", (t) => {
  const { tree, git, commit } = repository(t);
  git("switch", "-qc", "remote-main");
  const remote = commit("src/unmapped.ts");
  git("update-ref", "refs/remotes/origin/main", remote);
  git("switch", "-qc", "intent", "main");
  commit("src/lib/dashboard/own.svelte");
  const anchor = impact.anchorFor(tree, "main");
  git("merge", "--no-edit", "origin/main");
  assert.deepEqual(impact.changedSince(tree, anchor), ["src/lib/dashboard/own.svelte"]);
});

test("a direct build on the base keeps its own commit and excludes a later fold", (t) => {
  const { tree, git, commit } = repository(t);
  git("switch", "-qc", "remote-main");
  const remote = commit("src/unmapped.ts");
  git("update-ref", "refs/remotes/origin/main", remote);
  git("switch", "-q", "main");
  commit("src/lib/dashboard/own.svelte");
  const anchor = impact.anchorFor(tree, "main");
  git("merge", "--no-edit", "origin/main");
  assert.deepEqual(impact.changedSince(tree, anchor), ["src/lib/dashboard/own.svelte"]);
});

test("a net-reverted intent path buys no browser run", (t) => {
  const { tree, git, commit } = repository(t);
  commit("src/lib/dashboard/existing.svelte", "original");
  git("switch", "-qc", "intent");
  commit("src/lib/dashboard/existing.svelte", "changed");
  commit("src/lib/dashboard/existing.svelte", "original");
  assert.deepEqual(impact.changedSince(tree, impact.anchorFor(tree, "main")), []);
});
