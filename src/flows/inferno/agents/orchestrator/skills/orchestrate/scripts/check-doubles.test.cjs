const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const RUN = path.join(__dirname, "run.cjs");
const CHECK = path.join(__dirname, "check-doubles.cjs");
const RULE = /A test double may only fake the outside world \(network, clock, keys, outages\)\. Everything else runs the real code\./;

// A desktop shell whose e2e files install the native bridge by hand.
const BRIDGE = `delivery:
  base_branch: main
doubles:
  pattern: '__TAURI_INTERNALS__'
  paths: ['e2e/**']
`;

// A web app whose e2e files assign a whole service object, with one contract file allowed to.
const SERVICE = `delivery:
  base_branch: main
doubles:
  pattern: 'window\\.\\w+Api\\s*='
  paths:
    - e2e/**
  exclude:
    - e2e/contract.ts
`;

const NONE = "delivery:\n  base_branch: main\n";

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A repo on main with `files`, then a feature branch checked out on top of it. */
function repo(config, files, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-doubles-"));
  const root = path.join(dir, "app");
  fs.mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  write(root, ".specs-inferno/config.yaml", config);
  write(root, "src/app.ts", "export const app = 1;\n");
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  if (options.origin) {
    const remote = path.join(dir, "remote.git");
    git(dir, ["init", "--bare", "-q", remote]);
    git(root, ["remote", "add", "origin", remote]);
    git(root, ["push", "-qu", "origin", "main"]);
  }
  git(root, ["checkout", "-qb", "feature"]);
  return { dir, root, cache: path.join(dir, "cache") };
}

function land(fixture, files, removed = []) {
  for (const [rel, body] of Object.entries(files)) write(fixture.root, rel, body);
  for (const rel of removed) git(fixture.root, ["rm", "-q", rel]);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "landed"]);
}

function run(fixture, script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  return { code: result.status, out: (result.stdout || "") + (result.stderr || "") };
}

const BRIDGED = "window.__TAURI_INTERNALS__ = { invoke() {} };\n";

test("a branch that adds a file faking the bridge is refused with the file and the rule", () => {
  const fixture = repo(BRIDGE, { "e2e/old.spec.ts": BRIDGED });
  land(fixture, { "e2e/new.spec.ts": BRIDGED, "src/app.ts": "export const app = 2;\n" });
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /e2e\/new\.spec\.ts/);
  assert.doesNotMatch(result.out, /e2e\/old\.spec\.ts/);
  assert.match(result.out, /1 -> 2/);
  assert.match(result.out, RULE);
});

test("an equal count passes and prints it", () => {
  const fixture = repo(BRIDGE, { "e2e/old.spec.ts": BRIDGED });
  land(fixture, { "e2e/old.spec.ts": `${BRIDGED}// touched\n`, "e2e/real.spec.ts": "await page.goto('/');\n" });
  const result = run(fixture, CHECK, ["--tree", fixture.root]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS doubles 1 \(base 1\)/);
});

test("a fallen count passes and prints it", () => {
  const fixture = repo(BRIDGE, { "e2e/one.spec.ts": BRIDGED, "e2e/two.spec.ts": BRIDGED });
  land(fixture, { "e2e/one.spec.ts": "await page.goto('/');\n" }, ["e2e/two.spec.ts"]);
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS doubles 0 \(base 2\)/);
});

test("a config with no doubles key skips and says which config", () => {
  const fixture = repo(NONE, {});
  land(fixture, { "e2e/new.spec.ts": BRIDGED });
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /SKIP doubles \(no doubles in \.specs-inferno\/config\.yaml\)/);
});

test("an excluded contract file and a file outside the paths are not counted", () => {
  const fixture = repo(SERVICE, { "e2e/contract.ts": "export const contract = 1;\n" });
  land(fixture, {
    "e2e/contract.ts": "window.shopApi = makeFake();\n",
    "src/boot.ts": "window.shopApi = realApi();\n",
  });
  const held = run(fixture, CHECK, ["--tree", fixture.root]);
  assert.equal(held.code, 0, held.out);
  assert.match(held.out, /PASS doubles 0 \(base 0\)/);
  land(fixture, { "e2e/cart.spec.ts": "window.cartApi = {};\n" });
  const result = run(fixture, CHECK, ["--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /e2e\/cart\.spec\.ts/);
});

test("a selected config inherits the doubles key from the default config", () => {
  const fixture = repo(BRIDGE, { ".specs-inferno/other.yaml": NONE });
  land(fixture, { "e2e/new.spec.ts": BRIDGED });
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root, "--config", ".specs-inferno/other.yaml"]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, RULE);
});

test("integrate refuses a rising count before any integrate command runs", () => {
  const config = `${BRIDGE}verification:\n  integrate:\n    - echo ran > ../ran\n`;
  const fixture = repo(config, {});
  land(fixture, { "e2e/new.spec.ts": BRIDGED });
  const result = run(fixture, RUN, ["integrate", "--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /e2e\/new\.spec\.ts/);
  assert.match(result.out, RULE);
  assert.ok(!fs.existsSync(path.join(fixture.dir, "ran")), "no integrate command ran before the refusal");
});

test("integrate runs the check and then its commands when the count holds", () => {
  const config = `${BRIDGE}verification:\n  integrate:\n    - echo integrate ran\n`;
  const fixture = repo(config, { "e2e/old.spec.ts": BRIDGED });
  land(fixture, { "src/app.ts": "export const app = 3;\n" });
  const result = run(fixture, RUN, ["integrate", "--tree", fixture.root]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS doubles 1 \(base 1\)/);
  assert.match(result.out, /PASS \d+s echo integrate ran/);
});

test("a double the base gained after the fork is not credited to the branch", () => {
  const fixture = repo(BRIDGE, {});
  git(fixture.root, ["checkout", "-q", "main"]);
  land(fixture, { "e2e/main-added.spec.ts": BRIDGED });
  git(fixture.root, ["checkout", "-q", "feature"]);
  land(fixture, { "e2e/branch-added.spec.ts": BRIDGED });
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /0 -> 1/);
  assert.match(result.out, /e2e\/branch-added\.spec\.ts/);
});

/** Move origin/main ahead of the local main by one commit, which integrate then folds in. */
function originAhead(fixture, files, removed = []) {
  git(fixture.root, ["checkout", "-q", "main"]);
  land(fixture, files, removed);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  git(fixture.root, ["reset", "-q", "--hard", "HEAD~1"]);
  git(fixture.root, ["checkout", "-q", "feature"]);
}

test("a double that reached origin and not the local base is not credited to the branch", () => {
  const config = `${BRIDGE}verification:\n  integrate:\n    - echo integrate ran\n`;
  const fixture = repo(config, {}, { origin: true });
  originAhead(fixture, { "e2e/other-machine.spec.ts": BRIDGED });
  land(fixture, { "src/app.ts": "export const app = 5;\n" });
  const result = run(fixture, RUN, ["integrate", "--tree", fixture.root]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS doubles 1 \(base 1\)/);
});

test("doubles that origin removed do not hide a double the branch adds", () => {
  const config = `${BRIDGE}verification:\n  integrate:\n    - echo integrate ran\n`;
  const fixture = repo(config, { "e2e/one.spec.ts": BRIDGED, "e2e/two.spec.ts": BRIDGED }, { origin: true });
  originAhead(fixture, {}, ["e2e/one.spec.ts", "e2e/two.spec.ts"]);
  land(fixture, { "e2e/branch-added.spec.ts": BRIDGED });
  const alone = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(alone.code, 2, alone.out);
  assert.match(alone.out, /2 -> 3/);
  const result = run(fixture, RUN, ["integrate", "--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /0 -> 1/);
  assert.match(result.out, /e2e\/branch-added\.spec\.ts/);
});

test("a double on the local base that origin has not seen is not credited to the branch", () => {
  const config = `${BRIDGE}verification:\n  integrate:\n    - echo integrate ran\n`;
  const fixture = repo(config, {}, { origin: true });
  git(fixture.root, ["checkout", "-q", "main"]);
  land(fixture, { "e2e/local-only.spec.ts": BRIDGED });
  git(fixture.root, ["checkout", "-q", "feature"]);
  land(fixture, { "src/app.ts": "export const app = 6;\n" });
  const result = run(fixture, RUN, ["integrate", "--tree", fixture.root]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS doubles 1 \(base 1\)/);
});

test("a long list of new files never pushes the rule out of the output", () => {
  const fixture = repo(BRIDGE, {});
  const files = {};
  for (let i = 0; i < 40; i += 1) files[`e2e/n${i}.spec.ts`] = BRIDGED;
  land(fixture, files);
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, RULE);
  assert.match(result.out, /and 20 more/);
});

test("with no base configured the check refuses instead of comparing the branch with itself", () => {
  const fixture = repo("doubles:\n  pattern: '__TAURI_INTERNALS__'\n  paths: ['e2e/**']\n", {});
  land(fixture, { "e2e/new.spec.ts": BRIDGED });
  const result = run(fixture, RUN, ["doubles", "--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /BAD_CONFIG/);
  assert.match(result.out, /delivery\.base_branch/);
});

test("a base that shares no history with the branch is refused, never counted at its tip", () => {
  const fixture = repo(BRIDGE, {});
  git(fixture.root, ["checkout", "-q", "--orphan", "lonely"]);
  git(fixture.root, ["rm", "-rqf", "."]);
  land(fixture, { ".specs-inferno/config.yaml": BRIDGE.replace("main", "feature"), "e2e/x.spec.ts": BRIDGED });
  const result = run(fixture, CHECK, ["--tree", fixture.root]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /merge base/);
});
