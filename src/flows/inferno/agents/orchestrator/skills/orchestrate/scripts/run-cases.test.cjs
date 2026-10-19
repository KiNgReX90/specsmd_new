const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");
const runCases = require("./run-cases.cjs");

const RUN = path.join(__dirname, "run.cjs");

// The case texts, the tests that prove them, the product source and the tests whose expectations a
// case describes, as a host names them. The runbook joins the stale-text rule only.
const CONFIG = String.raw`delivery:
  base_branch: main
cases:
  files:
    - path: integration/TEST-CASES.md
      case: '^### (TC-\d+)'
    - path: docs/RELEASE-RUNBOOK.md
      case: '^\s*- \*\*([A-Z][\w-]+)\*\*'
      rules: [stale]
  tests: ["integration/*.test.mjs"]
  sources: ["src/**", "src-tauri/src/**"]
  expectations: ["e2e/**", "src/**/*.test.ts", "src-tauri/src/**/*tests.rs"]
`;
const UNSET = "delivery:\n  base_branch: main\n";

const CASES = `# Tester cases

## Settings

### TC-101 The request budget
Open the watch settings and step the requests per run up and down.

**Expected:** the budget counts requests.

### TC-102 Dismissing a run
Press Dismiss on the run card.

**Expected:** the card leaves the board and the count drops by one.

### TC-103 The form columns
**Expected:** the form draws one or two columns as it widens.
`;

const RUNBOOK = `# Release runbook

## Hand checks

- **HC-tray** Click the tray icon and read Open Watch in its menu.
- **HC-quit** Quit from the tray menu.
`;

const PROVING = `import { test } from 'node:test';
import { click, read } from './lib/driver.mjs';

const HINT = 'settings.watch.key.hint';

test('TC-101 the budget steps up and down', async () => {
\tawait click('budget-more');
\tawait read('settings.watch.budget.name');
});

test('TC-102 a dismissed run leaves the board', async () => {
\tawait click('run-dismiss');
\tawait read('run-count');
});
`;

const SPEC = `import { expect, test } from '@playwright/test';

test.describe('the form', () => {
\ttest('lays fields in two columns at 74.5em', async ({ page }) => {
\t\texpect(await columns(page)).toBe(2);
\t});

\ttest('keeps its labels above the fields', async ({ page }) => {
\t\texpect(await labels(page)).toBe('above');
\t});
});
`;

const UNIT = `import { describe, expect, it } from 'vitest';

describe('the form steps', () => {
\tit('holds both column steps at the thresholds', () => {
\t\texpect(STEPS).toEqual([1, 2]);
\t});
});
`;

const RUST = `#[test]
fn budget_defaults_to_150() {
    assert_eq!(budget(), 150);
}
`;

const CATALOGUE = (name, hint) => `export default {\n\t'settings.watch.budget.name': '${name}',\n\t'settings.watch.key.hint': '${hint}',\n};\n`;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFile(path.join(root, rel), body, "utf8");
}

/** A host on main with its cases, a runbook, the proving tests, a few screens and their unit and e2e tests. */
function repo(config = CONFIG, files = {}) {
  const dir = tempDir("inferno-cases-");
  const root = path.join(dir, "app");
  fs.mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  write(root, ".specs-inferno/config.yaml", config);
  write(root, "integration/TEST-CASES.md", CASES);
  write(root, "docs/RELEASE-RUNBOOK.md", RUNBOOK);
  write(root, "integration/settings.test.mjs", PROVING);
  write(root, "src/lib/Settings.svelte", '<h2>Watch settings</h2>\n<button data-testid="budget-more">+</button>\n');
  write(root, "src/lib/i18n/en.settings.ts", CATALOGUE("Requests per run", "Paste the key"));
  write(root, "src/lib/RunCard.svelte", '<button data-testid="run-dismiss" class="plain">Dismiss</button>\n<output data-testid="run-count">{count}</output>\n');
  write(root, "src/lib/TrayMenu.svelte", '<button data-testid="tray-open">Open Watch</button>\n');
  write(root, "src/lib/form.css", ".form { columns: 2; }\n");
  write(root, "src/lib/form.test.ts", UNIT);
  write(root, "e2e/form.spec.ts", SPEC);
  write(root, "src-tauri/src/watch_tests.rs", RUST);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  return { dir, root, base: git(root, ["rev-parse", "HEAD"]) };
}

/** One commit on top: the files it writes, and a message whose body may carry a `Cases:` line. */
function land(fixture, files, body = "") {
  for (const [rel, text] of Object.entries(files)) write(fixture.root, rel, text);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-q", "--allow-empty", "-m", "landed", ...(body ? ["-m", body] : [])]);
}

function check(fixture, extra = []) {
  const result = spawnSync(process.execPath, [RUN, "cases", "--range", `${fixture.base}..HEAD`, "--tree", fixture.root, ...extra], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: path.join(fixture.dir, "cache") },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

const payload = (fixture) => JSON.parse(check(fixture, ["--json"]).out);
const ids = (entries) => entries.map((entry) => entry.case).sort();
const titles = (entries) => entries.map((entry) => `${entry.file} ${entry.title}`).sort();

// --- no section, no gate ----------------------------------------------------------

test("a host without a cases section exits clean and prints nothing, whatever the range changed", () => {
  const fixture = repo(UNSET);
  land(fixture, {
    "src/lib/i18n/en.settings.ts": CATALOGUE("Minutes a check may spend", "Paste the key"),
    "e2e/form.spec.ts": SPEC.replace("toBe(2)", "toBe(1)"),
  });
  const result = check(fixture);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, "");
  const direct = runCases.cases({ tree: fixture.root, range: `${fixture.base}..HEAD` }, {});
  assert.equal(direct.exit, 0);
  assert.equal(direct.payload.skipped, true);
});

// --- rule 1: a case names a label the range took away ---------------------------------

test("a case naming a removed label is stale, matched across case, and a Cases line never answers it", () => {
  const fixture = repo();
  land(fixture, { "src/lib/i18n/en.settings.ts": CATALOGUE("Minutes a check may spend", "Paste the key") }, "Cases: TC-101");
  const red = check(fixture);
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /^stale TC-101 in integration\/TEST-CASES\.md names label "Requests per run" that the range removed$/m);
  assert.match(red.out, /^answer: .*edit/m);
  assert.deepEqual(payload(fixture).stale, [{ case: "TC-101", file: "integration/TEST-CASES.md", key: "Requests per run" }]);

  land(fixture, { "integration/TEST-CASES.md": CASES.replace("requests per run", "minutes a check may spend") });
  const green = check(fixture);
  assert.equal(green.code, 0, green.out + green.err);
  assert.equal(green.out, "");
});

test("a label that moved to another screen is not stale", () => {
  const fixture = repo();
  land(fixture, {
    "src/lib/i18n/en.settings.ts": CATALOGUE("Minutes a check may spend", "Paste the key"),
    "src/lib/Budget.svelte": "<label for=b>Requests per run</label>\n",
  });
  assert.deepEqual(payload(fixture).stale, []);
});

test("a runbook hand check naming a removed label is stale until the check is edited", () => {
  const fixture = repo();
  land(fixture, { "src/lib/TrayMenu.svelte": '<button data-testid="tray-open">Show Watch</button>\n' });
  const red = check(fixture);
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /^stale HC-tray in docs\/RELEASE-RUNBOOK\.md names label "Open Watch" that the range removed$/m);

  land(fixture, { "docs/RELEASE-RUNBOOK.md": RUNBOOK.replace("Open Watch", "Show Watch") });
  const green = check(fixture);
  assert.equal(green.code, 0, green.out + green.err);
});

test("a runbook hand check joins the stale rule only, so a changed label it names asks nothing", () => {
  const fixture = repo();
  land(fixture, { "src/lib/TrayMenu.svelte": '<button data-testid="tray-open" class="wide">Open Watch</button>\n' });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.out, "");
});

// --- rule 2: the cases a change reaches are read and answered ---------------------------

test("a changed proving test block makes its own case a candidate, not every case in the file", () => {
  const fixture = repo();
  land(fixture, { "integration/settings.test.mjs": PROVING.replace("click('budget-more');", "click('budget-more', { twice: true });") });
  const red = check(fixture);
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /^unanswered TC-101 /m);
  assert.deepEqual(ids(payload(fixture).unanswered), ["TC-101"]);
});

test("Cases: none never answers a candidate, and naming the case does", () => {
  const fixture = repo();
  land(fixture, { "integration/settings.test.mjs": PROVING.replace("click('budget-more');", "click('budget-more', { twice: true });") }, "Cases: none");
  const refused = check(fixture);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.deepEqual(ids(payload(fixture).unanswered), ["TC-101"]);

  land(fixture, {}, "Cases: TC-101, TC-999");
  const green = check(fixture);
  assert.equal(green.code, 0, green.out + green.err);
  assert.equal(green.out, "");
});

test("an edited case block answers its candidacy without a Cases line", () => {
  const fixture = repo();
  land(fixture, {
    "integration/settings.test.mjs": PROVING.replace("click('budget-more');", "click('budget-more', { twice: true });"),
    "integration/TEST-CASES.md": CASES.replace("step the requests per run up and down", "step the requests per run up twice"),
  });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
});

test("a case naming a label a changed source line declares is a candidate, across case for two words", () => {
  const fixture = repo();
  land(fixture, { "src/lib/Settings.svelte": '<h2 class="lead">Watch settings</h2>\n<button data-testid="budget-more">+</button>\n' });
  const result = check(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  const found = payload(fixture);
  assert.deepEqual(found.stale, []);
  assert.deepEqual(ids(found.unanswered), ["TC-101"]);
});

test("a test id declared on a changed source line reaches the case of the test block that names it", () => {
  const fixture = repo();
  land(fixture, { "src/lib/RunCard.svelte": '<button data-testid="run-dismiss" class="plain">Dismiss</button>\n<output data-testid="run-count" class="n">{count}</output>\n' });
  const result = check(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(ids(payload(fixture).unanswered), ["TC-102"]);
});

test("a catalogue key a proving test names at module level reaches every case that file names", () => {
  const fixture = repo();
  land(fixture, { "src/lib/i18n/en.settings.ts": CATALOGUE("Requests per run", "Paste your key") });
  const result = check(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  const found = payload(fixture);
  assert.deepEqual(found.stale, []);
  assert.deepEqual(ids(found.unanswered), ["TC-101", "TC-102"]);
});

// --- rule 3: a changed expectation is answered -------------------------------------------

const COLUMNS = {
  "src/lib/form.css": ".form { columns: 1; }\n",
  "e2e/form.spec.ts": SPEC.replace("toBe(2)", "toBe(1)"),
  "src/lib/form.test.ts": UNIT.replace("[1, 2]", "[1]"),
  "src-tauri/src/watch_tests.rs": RUST.replace("budget(), 150", "budget(), 120"),
};

test("a changed expectation with no case edited is refused with the title of each test it changed", () => {
  const fixture = repo();
  land(fixture, COLUMNS);
  const red = check(fixture);
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /lays fields in two columns at 74\.5em/);
  assert.match(red.out, /holds both column steps at the thresholds/);
  assert.match(red.out, /budget_defaults_to_150/);
  assert.doesNotMatch(red.out, /keeps its labels above the fields/);
  assert.match(red.out, /^answer: .*Cases: none/m);
  assert.deepEqual(titles(payload(fixture).expectations), [
    "e2e/form.spec.ts lays fields in two columns at 74.5em",
    "src-tauri/src/watch_tests.rs budget_defaults_to_150",
    "src/lib/form.test.ts holds both column steps at the thresholds",
  ]);

  land(fixture, {}, "Cases: none");
  const green = check(fixture);
  assert.equal(green.code, 0, green.out + green.err);
  assert.equal(green.out, "");
});

test("an edited case block answers a changed expectation", () => {
  const fixture = repo();
  land(fixture, { ...COLUMNS, "integration/TEST-CASES.md": CASES.replace("one or two columns as it widens", "one column") });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
});

test("a test added to an existing file, or a new test file, changes no expectation", () => {
  const fixture = repo();
  land(fixture, {
    "e2e/form.spec.ts": `${SPEC}\ntest('opens on the first field', async () => {\n\texpect(1).toBe(1);\n});\n`,
    "e2e/new.spec.ts": "test('a new journey', async () => {\n\texpect(1).toBe(1);\n});\n",
  });
  const result = check(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(payload(fixture).expectations, []);
});

test("a refusal shows eight changed test titles and counts the rest", () => {
  const steps = Array.from({ length: 10 }, (_, i) => i + 1);
  const many = (value) => steps.map((i) => `test('step ${i}', () => {\n\texpect(${value}).toBe(${i});\n});\n`).join("\n");
  const fixture = repo(CONFIG, { "e2e/many.spec.ts": many("n") });
  land(fixture, { "e2e/many.spec.ts": many("m") });
  const red = check(fixture);
  assert.equal(red.code, 2, red.out + red.err);
  for (const i of steps.slice(0, 8)) assert.match(red.out, new RegExp(`step ${i}\\b`));
  assert.doesNotMatch(red.out, /step 9\b/);
  assert.match(red.out, /and 2 more/);
  assert.equal(payload(fixture).expectations.length, 10);
});

// --- config ------------------------------------------------------------------------------

test("a Codex config inherits the cases section from the project config", () => {
  const fixture = repo(CONFIG, { ".specs-inferno/config.codex.yaml": "host: codex\n" });
  land(fixture, { "src/lib/i18n/en.settings.ts": CATALOGUE("Minutes a check may spend", "Paste the key") });
  const result = check(fixture, ["--config", ".specs-inferno/config.codex.yaml"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^stale TC-101 /m);
});

test("a cases section of the wrong shape is refused with the shape it needs", () => {
  const listed = check(repo("cases:\n  - integration/TEST-CASES.md\n"));
  assert.equal(listed.code, 2);
  assert.match(listed.err, /BAD_CONFIG.*cases/);
  const noOpener = check(repo("cases:\n  files:\n    - path: integration/TEST-CASES.md\n"));
  assert.equal(noOpener.code, 2);
  assert.match(noOpener.err, /BAD_CONFIG.*case/);
});

test("a set section without a range is a usage error", () => {
  const fixture = repo();
  const result = spawnSync(process.execPath, [RUN, "cases", "--tree", fixture.root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: node run\.cjs cases --range/);
});
