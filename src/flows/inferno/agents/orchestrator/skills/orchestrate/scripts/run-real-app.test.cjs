const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");
const realApp = require("./run-real-app.cjs");

const RUN = path.join(__dirname, "run.cjs");

// The helpers and case texts that drive the real app binary, as a host names them.
const CONFIG = `delivery:
  base_branch: main
real_app:
  paths: ["integration/lib/**", "integration/*.test.mjs", "integration/TEST-CASES.md"]   # globs
`;
const UNSET = "delivery:\n  base_branch: main\n";

// --- what counts as a declaration ------------------------------------------

const keys = (line, file = "src/lib/Panel.svelte") => realApp.declared(line, file).map((entry) => `${entry.kind} ${entry.key}`);

test("a test id is read from its attribute, its braces, its ternary branches and its bindings", () => {
  assert.deepEqual(keys('<div data-testid="walkthrough-next">'), ["testid walkthrough-next"]);
  assert.deepEqual(keys("<div data-testid='walk'>"), ["testid walk"]);
  assert.deepEqual(keys("<p data-testid={'plain'}>"), ["testid plain"]);
  assert.deepEqual(keys("<input data-testid={moment === 'register' ? 'register-name' : 'product-name'} />"), [
    "testid register-name", "testid product-name",
  ]);
  assert.deepEqual(keys(`<li [attr.data-testid]="'fb-row'">`, "src/app/list.component.html"), ["testid fb-row"]);
  assert.deepEqual(keys('<b data-cy="cy-target">'), ["testid cy-target"]);
});

test("a test id built at run time is no declaration", () => {
  assert.deepEqual(keys('<div data-testid="tile-{id}">'), []);
  assert.deepEqual(keys("<div data-testid={`version-${id}`}>"), []);
  assert.deepEqual(keys(`<li [attr.data-testid]="'fb-kind-' + entry.kind">`), []);
  assert.deepEqual(keys("<div data-testid={action.testid}>"), []);
});

test("a label is read from its attribute, one-line element text and a flat catalogue entry", () => {
  assert.deepEqual(keys('<button aria-label="Close settings">'), ["label Close settings"]);
  assert.deepEqual(keys('<button class="go">Save draft</button>'), ["label Save draft"]);
  assert.deepEqual(keys("<label for=x>Product name</label>"), ["label Product name"]);
  assert.deepEqual(keys("\t'runs.dismiss': 'Dismiss',", "src/lib/i18n/en.shell.ts"), ["copy runs.dismiss", "label Dismiss"]);
  assert.deepEqual(keys('  "board.open": "Open {name}",', "src/i18n/en.json"), ["copy board.open"]);
  assert.deepEqual(keys("<button aria-label={t('a.b')}>"), []);
  assert.deepEqual(keys('<button aria-label="Open {name}">'), []);
});

test("a route is read from a route config line and from a page file", () => {
  assert.deepEqual(keys("  { path: 'activity', component: Activity },", "src/app/app.routes.ts"), ["route /activity"]);
  assert.deepEqual(keys('<Route path="/vault" element={<Vault />} />', "src/routes.tsx"), ["route /vault"]);
  assert.deepEqual(keys("  { path: 'activity' },", "src/app/data.ts"), []);
  assert.deepEqual(keys("  { path: 'product/:id' },", "src/app/app.routes.ts"), []);
  assert.deepEqual(keys("  { path: '', redirectTo: '/classic' },", "src/app/app.routes.ts"), []);
  assert.equal(realApp.pageRoute("src/routes/(app)/product/+page.svelte"), "/product");
  assert.equal(realApp.pageRoute("src/routes/sbom/+page.ts"), "/sbom");
  assert.equal(realApp.pageRoute("app/settings/page.tsx"), "/settings");
  assert.equal(realApp.pageRoute("src/routes/+page.svelte"), null);
  assert.equal(realApp.pageRoute("src/routes/product/[id]/+page.svelte"), null);
  assert.equal(realApp.pageRoute("src/lib/page.ts"), null);
});

test("a helper names a key only at its edges, and a label only whole in quotes", () => {
  assert.equal(realApp.names("testid=walkthrough  (", { kind: "testid", key: "walkthrough" }), true);
  assert.equal(realApp.names("testid=walkthrough-skip", { kind: "testid", key: "walkthrough" }), false);
  assert.equal(realApp.names('assert.match(card, /button "Dismiss"/)', { kind: "label", key: "Dismiss" }), true);
  assert.equal(realApp.names('button "Dismiss all"', { kind: "label", key: "Dismiss" }), false);
  assert.equal(realApp.names("uiCopy('runs.dismiss')", { kind: "copy", key: "runs.dismiss" }), true);
  assert.equal(realApp.names("uiCopy('runs.dismiss.all')", { kind: "copy", key: "runs.dismiss" }), false);
  assert.equal(realApp.names("await t.goto('/sbom?x=1');", { kind: "route", key: "/sbom" }), true);
  assert.equal(realApp.names("await t.goto('/sbom-export');", { kind: "route", key: "/sbom" }), false);
});

// --- the check over a real range -------------------------------------------

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFile(path.join(root, rel), body, "utf8");
}

const HELPER = `export async function skipIntro(t) {
  if (!screen.includes('testid=walkthrough-next')) return;
  await t.goto('/sbom');
  assert.match(await t.snapshot(), /button "Dismiss"/);
  return uiCopy('runs.dismiss');
}
`;

/** A host on main with one screen, its catalogue, a page and the helper that drives them. */
function repo(config = CONFIG, files = {}) {
  const dir = tempDir("inferno-real-app-");
  const root = path.join(dir, "app");
  fs.mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  write(root, ".specs-inferno/config.yaml", config);
  write(root, "src/lib/Walkthrough.svelte", '<div data-testid="walkthrough-next">Next</div>\n');
  write(root, "src/lib/i18n/en.shell.ts", "export default {\n\t'runs.dismiss': 'Dismiss',\n};\n");
  write(root, "src/routes/sbom/+page.svelte", "<h1>SBOM</h1>\n");
  write(root, "integration/lib/journeys.mjs", HELPER);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  return { dir, root, base: git(root, ["rev-parse", "HEAD"]) };
}

function land(fixture, files, removed = []) {
  for (const [rel, body] of Object.entries(files)) write(fixture.root, rel, body);
  for (const rel of removed) git(fixture.root, ["rm", "-q", rel]);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "landed"]);
}

const stale = (out) => out.split("\n").filter((line) => line.startsWith("stale "));
const drives = (out) => out.split("\n").filter((line) => line.startsWith("drives "));

function check(fixture, extra = []) {
  const result = spawnSync(process.execPath, [RUN, "real-app", "--range", `${fixture.base}..HEAD`, "--tree", fixture.root, ...extra], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: path.join(fixture.dir, "cache") },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

test("a host without real_app.paths prints nothing and exits clean, whatever the diff removed", () => {
  const fixture = repo(UNSET);
  land(fixture, { "src/lib/Walkthrough.svelte": "<div>Done</div>\n" });
  const result = check(fixture);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, "");
  assert.equal(check(repo("real_app:\n  paths: []\n")).out, "");
});

test("a removed test id a helper still names is a hit with its file and line", () => {
  const fixture = repo();
  land(fixture, { "src/lib/Walkthrough.svelte": '<div data-testid="intro-step">Next</div>\n' });
  const result = check(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(stale(result.out), ["stale integration/lib/journeys.mjs:2 names testid walkthrough-next that the diff removed"]);
  const payload = JSON.parse(check(fixture, ["--json"]).out);
  assert.deepEqual(payload.stale, [{ file: "integration/lib/journeys.mjs", line: 2, kind: "testid", key: "walkthrough-next" }]);
});

test("a renamed label, a removed catalogue key and a deleted page are hits too", () => {
  const fixture = repo();
  land(fixture, { "src/lib/i18n/en.shell.ts": "export default {\n\t'runs.close': 'Close',\n};\n" }, ["src/routes/sbom/+page.svelte"]);
  assert.deepEqual(stale(check(fixture).out), [
    "stale integration/lib/journeys.mjs:3 names route /sbom that the diff removed",
    'stale integration/lib/journeys.mjs:4 names label "Dismiss" that the diff removed',
    "stale integration/lib/journeys.mjs:5 names copy key runs.dismiss that the diff removed",
  ]);
});

test("a helper the same diff updated asks nothing, and neither does a line it added", () => {
  const fixture = repo();
  land(fixture, {
    "src/lib/Walkthrough.svelte": "<div>Next</div>\n",
    "integration/lib/journeys.mjs": HELPER.replace("testid=walkthrough-next", "testid=intro-step"),
    "integration/TEST-CASES.md": "The introduction no longer shows `testid=walkthrough-next`.\n",
  });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(stale(result.out), []);
});

test("a test id that moved to another screen is still declared and asks nothing", () => {
  const fixture = repo();
  land(fixture, { "src/lib/Walkthrough.svelte": "<div>Next</div>\n", "src/lib/Intro.svelte": '<b data-testid="walkthrough-next">Go</b>\n' });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(stale(result.out), []);
});

test("an id or label that moved into a constant the screen renders is still live", () => {
  const fixture = repo();
  land(fixture, {
    "src/lib/Walkthrough.svelte": "<div data-testid={step.testid}>Next</div>\n",
    "src/lib/steps.ts": "export const step = { testid: 'walkthrough-next', dismiss: \"Dismiss\" };\n",
    "src/lib/i18n/en.shell.ts": "export default {\n\t'runs.dismiss': dismiss,\n};\n",
  });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(stale(result.out), []);
});

test("a doc that quotes an id keeps nothing live, and a doc that changes drives nothing", () => {
  const fixture = repo(CONFIG, { "docs/screens.md": 'The intro shows `data-testid="walkthrough-next"`.\n' });
  land(fixture, { "src/lib/Walkthrough.svelte": "<div>Next</div>\n", "docs/screens.md": 'The intro showed "walkthrough-next".\n' });
  const result = check(fixture);
  assert.deepEqual(stale(result.out), ["stale integration/lib/journeys.mjs:2 names testid walkthrough-next that the diff removed"]);
  assert.deepEqual(drives(result.out), ["drives integration/lib/journeys.mjs via testid walkthrough-next"]);
});

test("a removal in a test file, or one only a file outside the configured paths names, asks nothing", () => {
  const fixture = repo(CONFIG, {
    "src/lib/panel.test.ts": "render('<i data-testid=\"panel-only\"></i>');\n",
    "integration/lib/panel.mjs": "find('testid=panel-only');\n",
    "src/lib/Gone.svelte": '<i data-testid="gone-id"></i>\n',
    "e2e/gone.spec.ts": "getByTestId('gone-id');\n",
  });
  land(fixture, { "src/lib/panel.test.ts": "render('<i></i>');\n" }, ["src/lib/Gone.svelte"]);
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.out, "");
});

// --- the files to read against the new behaviour --------------------------------

test("a screen that changed behaviour and kept its ids names every helper that drives it, once per file", () => {
  const fixture = repo(CONFIG, { "integration/intro.test.mjs": "await t.click('walkthrough-next');\nawait t.click('walkthrough-next');\n" });
  land(fixture, { "src/lib/Walkthrough.svelte": '<div data-testid="walkthrough-next" on:click={finish}>Finish</div>\n' });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(stale(result.out), []);
  assert.deepEqual(drives(result.out), [
    "drives integration/intro.test.mjs via testid walkthrough-next",
    "drives integration/lib/journeys.mjs via testid walkthrough-next",
  ]);
  const payload = JSON.parse(check(fixture, ["--json"]).out);
  assert.deepEqual(payload.drives[0], { file: "integration/intro.test.mjs", keys: [{ kind: "testid", key: "walkthrough-next" }] });
});

test("a drives line counts shared test ids and copy keys, never a shared label", () => {
  const fixture = repo(CONFIG, { "src/lib/Panel.svelte": '<button aria-label="Dismiss">x</button>\n' });
  land(fixture, {
    "src/lib/Panel.svelte": '<button aria-label="Dismiss" class="wide">x</button>\n',
    "src/lib/i18n/en.shell.ts": "export default {\n\t'runs.dismiss': 'Dismiss',\n\t'runs.keep': 'Keep',\n};\n",
  });
  assert.deepEqual(drives(check(fixture).out), ["drives integration/lib/journeys.mjs via copy key runs.dismiss"]);
});

test("a drives line shows the first five shared keys and counts the rest", () => {
  const ids = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].map((key) => `step-${key}`);
  const fixture = repo(CONFIG, {
    "src/lib/Steps.svelte": ids.map((key) => `<i data-testid="${key}"></i>`).join("\n") + "\n",
    "integration/lib/steps.mjs": ids.map((key) => `find('testid=${key}');`).join("\n") + "\n",
  });
  land(fixture, { "src/lib/Steps.svelte": ids.map((key) => `<b data-testid="${key}"></b>`).join("\n") + "\n" });
  assert.deepEqual(drives(check(fixture).out), [
    "drives integration/lib/steps.mjs via testid step-a1, testid step-a2, testid step-a3, testid step-a4, testid step-a5 and 2 more",
  ]);
});

test("a changed file that declares nothing a helper names, and a changed test file, drive nothing", () => {
  const fixture = repo(CONFIG, { "src/lib/Other.svelte": '<i data-testid="other-id"></i>\n', "src/lib/w.test.ts": "'walkthrough-next';\n" });
  land(fixture, { "src/lib/Other.svelte": '<b data-testid="other-id"></b>\n', "src/lib/w.test.ts": "'walkthrough-next'; // again\n" });
  const result = check(fixture);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, "");
});

test("a Codex config inherits real_app.paths from the project config", () => {
  const fixture = repo(CONFIG, { ".specs-inferno/config.codex.yaml": "host: codex\n" });
  land(fixture, { "src/lib/Walkthrough.svelte": "<div>Next</div>\n" });
  const result = check(fixture, ["--config", ".specs-inferno/config.codex.yaml"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /journeys\.mjs:2 names testid walkthrough-next/);
});

test("a real_app key of the wrong shape is refused with the shape it needs", () => {
  const result = check(repo("real_app:\n  - integration/**\n"));
  assert.equal(result.code, 2);
  assert.match(result.err, /BAD_CONFIG.*real_app.*paths/);
});

test("a set key without a range is a usage error", () => {
  const fixture = repo();
  const result = spawnSync(process.execPath, [RUN, "real-app", "--tree", fixture.root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: node run\.cjs real-app --range/);
});
