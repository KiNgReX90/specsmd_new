const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { nextActor, tierOf } = require("./run-review.cjs");

const RUN = path.join(__dirname, "run.cjs");

// --- the ladder ------------------------------------------------------------
// Complexity alone decides who builds first. Rejections then move the item up: cheap after
// one, strong after two, the escalate builder after two more, and the oracle after every
// further two rejections on the escalate builder.

test("tierOf decides by complexity only", () => {
  assert.equal(tierOf({ complexity: "low", kind: "behavior" }), "cheap");
  assert.equal(tierOf({ complexity: "medium", kind: "docs-only" }), "strong");
  assert.equal(tierOf({ complexity: "high", kind: "test" }), "strong");
  assert.equal(tierOf({ complexity: "low", kind: "config" }), "cheap");
});

test("an item nobody rejected stays with the tier its complexity names", () => {
  assert.deepEqual(nextActor({ complexity: "low" }), {
    actor: "cheap", agent: "specsmd-inferno-builder-cheap", fresh: false, rejections: 0,
  });
  assert.equal(nextActor({ complexity: "medium" }).actor, "strong");
});

test("one rejection on the cheap tier hands the item to a fresh strong builder", () => {
  const next = nextActor({ complexity: "low", review_tier: "cheap", review_rejections: "1" });
  assert.equal(next.actor, "strong");
  assert.equal(next.agent, "specsmd-inferno-builder");
  assert.equal(next.fresh, true);
});

test("the strong tier fixes one rejection itself and hands over after the second", () => {
  const once = nextActor({ complexity: "medium", review_tier: "strong", review_rejections: 1 });
  assert.equal(once.actor, "strong");
  assert.equal(once.fresh, false);
  const twice = nextActor({ complexity: "medium", review_tier: "strong", review_rejections: 2 });
  assert.equal(twice.actor, "escalate");
  assert.equal(twice.agent, "specsmd-inferno-builder-escalate");
  assert.equal(twice.fresh, true);
});

test("two rejections on the escalate builder go to the oracle, and every two after that", () => {
  const item = (n) => nextActor({ complexity: "high", review_tier: "escalate", review_rejections: n });
  assert.equal(item(1).actor, "escalate");
  assert.equal(item(2).actor, "oracle");
  assert.equal(item(2).agent, "specsmd-inferno-oracle");
  // The oracle's decision goes to the warm escalate builder, and the count starts over.
  assert.equal(item(3).actor, "escalate");
  assert.equal(item(3).fresh, false);
  assert.equal(item(4).actor, "oracle");
});

// --- the review step ---------------------------------------------------------

const STATE = `project:
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
        status: pending
        depends_on: []
      - id: a-two
        title: "A two"
        kind: docs-only
        complexity: medium
        status: pending
        depends_on: [a-one]
`;

const CONFIG = `models:
  strong: model-strong
  cheap: model-cheap
  escalate: model-escalate
review:
  model: model-review
delivery:
  base_branch: main
`;

function spec(id, editable, depends = []) {
  return `---
id: ${id}
title: "${id}"
intent: alpha
status: pending
depends_on: [${depends.join(", ")}]
---

# Work Item: ${id}

## Execution Manifest

context:
  required:
    - path: src/a.ts
      reason: why
  patterns:
    - path: src/b.ts
      reason: why
  tests:
    - path: src/a.test.ts
      reason: why
ownership:
  editable:
${editable.map((p) => `    - ${p}`).join("\n")}
`;
}

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repo(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-review-"));
  const root = path.join(dir, "app");
  fs.mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  write(root, "src/a.ts", "export const a = 1;\n");
  write(root, "src/b.ts", "export const b = 2;\n");
  write(root, "src/a.test.ts", "// proof\n");
  write(root, "docs/b.md", "docs\n");
  write(root, ".specs-inferno/state.yaml", options.state || STATE);
  write(root, ".specs-inferno/config.yaml", options.config || CONFIG);
  write(root, ".specs-inferno/intents/alpha/brief.md", "# Intent: Alpha\n");
  write(root, ".specs-inferno/intents/alpha/work-items/a-one.md", spec("a-one", ["src/a.ts"]));
  write(root, ".specs-inferno/intents/alpha/work-items/a-two.md", spec("a-two", ["docs/b.md"], ["a-one"]));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "init"]);
  return { root, cache: path.join(dir, "cache") };
}

function run(fixture, args) {
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const ledger = (fixture) => fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8");
const review = (fixture, args = []) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, ...args]);

const CLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\nfindings: []\n";
const FIX = `item: a-one
verdict: fix
files:
  - src/a.ts
findings:
  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: read src/a.ts, it exports 1
    fix: export 2
mutants:
  - criterion: AC1 the value reads two
    test: node --test src/a.test.ts
    caught: yes
`;

test("review with no review file prints the reviewer dispatch line and exits 3", () => {
  const fixture = repo();
  const result = review(fixture);

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /dispatch specsmd-inferno-reviewer model model-review item a-one/);
  assert.match(result.out, /range [0-9a-f]{7,}\.\.[0-9a-f]{7,}/);
  assert.match(result.out, /spec \.specs-inferno\/intents\/alpha\/work-items\/a-one\.md/);
  assert.match(result.out, /brief \.specs-inferno\/intents\/alpha\/brief\.md/);
  assert.match(result.out, /write \.specs-inferno\/intents\/alpha\/reviews\/a-one\.yaml/);
});

test("review refuses an item whose work is not committed yet and names the fix", () => {
  const fixture = repo();
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  const result = review(fixture);

  assert.equal(result.code, 2);
  assert.match(result.err, /ERROR \[DIRTY\].*src\/a\.ts.*commit the item/);
});

test("a clean review is validated, recorded on the ledger and committed", () => {
  const fixture = repo();
  const head = git(fixture.root, ["rev-parse", "HEAD"]);
  write(fixture.root, REVIEW, CLEAN);

  const result = review(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /review a-one clean/);
  assert.match(result.out, /run\.cjs integrate --item a-one/);
  const state = ledger(fixture);
  assert.match(state, /review: clean/);
  assert.match(state, /review_hash: [0-9a-f]{64}/);
  assert.match(state, new RegExp(`review_commit: ${head}`));
  assert.match(state, /review_tier: cheap/);
  assert.match(state, /review_rejections: 0/);
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "", "the review and the ledger are committed");
  const recorded = fs.readFileSync(path.join(fixture.root, REVIEW), "utf8");
  assert.match(recorded, /^tree: [0-9a-f]{64}$/m);
  assert.match(recorded, new RegExp(`^commit: ${head}$`, "m"));

  // Asked again with nothing changed, it answers from the record and writes nothing.
  const tip = git(fixture.root, ["rev-parse", "HEAD"]);
  assert.equal(review(fixture).code, 0);
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), tip);
});

test("a fix review prints every finding and the next actor on the ladder, exit 2", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FIX);

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /FINDING AC1 the value reads two src\/a\.ts:1/);
  assert.match(result.out, /export 2/);
  // a-one is low, so one rejection hands it to a fresh strong builder.
  assert.match(result.out, /next strong model-strong specsmd-inferno-builder/);
  assert.match(ledger(fixture), /review: fix/);
  assert.match(ledger(fixture), /review_rejections: 1/);
});

test("a listed file that changes after the review voids it and asks for a delta review", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FIX);
  review(fixture);
  const reviewed = git(fixture.root, ["log", "-1", "--format=%H", "--", "src/a.ts"]);
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);

  const result = review(fixture);

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, new RegExp(`range ${reviewed.slice(0, 7)}[0-9a-f]*\\.\\.`));
  assert.match(result.out, /paths src\/a\.ts/);
});

test("the second review of a fix counts on the tier that built it", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FIX);
  review(fixture);
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the strong fix"]);
  write(fixture.root, REVIEW, CLEAN);

  const result = review(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  // The fix came from the strong builder the ladder named, so the count starts over there.
  assert.match(ledger(fixture), /review_tier: strong/);
  assert.match(ledger(fixture), /review_rejections: 0/);
});

test("a review file with a key outside the schema is refused and nothing is recorded", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, `${CLEAN}rest: the residual risks\n`);

  const result = review(fixture);

  assert.equal(result.code, 2);
  assert.match(result.err, /ERROR \[BAD_REVIEW\].*unknown key rest/);
  assert.doesNotMatch(ledger(fixture), /review:/);
});

test("a clean verdict that carries a finding or a surviving mutant is refused", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FIX.replace("verdict: fix", "verdict: clean"));
  assert.match(review(fixture).err, /BAD_REVIEW.*clean.*finding/);

  const survived = `${CLEAN}mutants:\n  - criterion: AC1\n    test: node --test src/a.test.ts\n    caught: no\n`;
  write(fixture.root, REVIEW, survived);
  assert.match(review(fixture).err, /BAD_REVIEW.*caught: no/);
});

test("a review that writes its own tree or commit is refused, since run.cjs records those", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, `${CLEAN}commit: abc1234\n`);
  const result = review(fixture);
  assert.equal(result.code, 2);
  assert.match(result.err, /BAD_REVIEW.*commit/);
});

test("a review of another item's file or of a path outside the tree is refused", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, CLEAN.replace("item: a-one", "item: a-two"));
  assert.match(review(fixture).err, /BAD_REVIEW.*item/);
  write(fixture.root, REVIEW, CLEAN.replace("[src/a.ts]", "[../outside.ts]"));
  assert.match(review(fixture).err, /BAD_REVIEW.*outside/);
});

// --- frontier prints the actor ---------------------------------------------------

test("frontier prints each ready item's tier with the model the config names for it", () => {
  const state = STATE.replace("        depends_on: [a-one]", "        depends_on: []");
  const fixture = repo({ state });
  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready a-one low behavior cheap model-cheap$/m);
  // docs-only no longer routes to the cheap tier: complexity alone decides.
  assert.match(result.out, /^ready a-two medium docs-only strong model-strong$/m);
});

test("frontier prints the same next line as review once an item was rejected", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FIX);
  const fixed = review(fixture);
  const nextLine = fixed.out.split("\n").find((line) => line.startsWith("next "));

  const result = run(fixture, ["frontier", "alpha", "--json"]);
  const payload = JSON.parse(result.out);
  assert.equal(payload.ready[0].tier, "strong");
  assert.equal(payload.ready[0].model, "model-strong");
  assert.ok(run(fixture, ["frontier", "alpha"]).out.includes(nextLine), nextLine);
});

test("frontier holds the successor of an item completed without a clean review after the rule", () => {
  const state = STATE.replace(
    /(- id: a-one[\s\S]*?)status: pending/,
    "$1status: completed\n        completed_at: 2099-01-01T00:00:00Z\n        integrated_sha: abc1234",
  );
  const fixture = repo({ state });
  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /HELD a-one: completed with no clean item review, run run\.cjs review --item a-one --tree/);
});
