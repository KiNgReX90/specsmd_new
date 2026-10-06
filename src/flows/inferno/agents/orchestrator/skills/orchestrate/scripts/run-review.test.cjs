const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { hostActor, nextActor, tierOf } = require("./run-review.cjs");
const { STATE, git, repo, run, write } = require("./review-fixture.cjs");

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

// --- the schema refuses every slot it does not name ---------------------------------

const refused = (fixture, body, pattern) => {
  write(fixture.root, REVIEW, body);
  const result = review(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, pattern);
  assert.doesNotMatch(ledger(fixture), /review:/);
};

test("a review that lists no files, or an empty list, is refused", () => {
  const fixture = repo();
  refused(fixture, "item: a-one\nverdict: clean\n", /BAD_REVIEW.*files must list/);
  refused(fixture, "item: a-one\nverdict: clean\nfiles: []\n", /BAD_REVIEW.*files must list/);
});

test("a fix verdict with no finding and no surviving mutant is refused", () => {
  refused(repo(), "item: a-one\nverdict: fix\nfiles: [src/a.ts]\nfindings: []\n", /BAD_REVIEW.*verdict fix with no finding/);
});

test("a key inside a finding that the schema does not name is refused", () => {
  const body = FIX.replace("    fix: export 2\n", "    fix: export 2\n    residual: maybe later\n");
  refused(repo(), body, /BAD_REVIEW.*unknown key residual in findings entry 1/);
});

test("a listed path that is not in the tree, or one in the ledger, is refused", () => {
  const fixture = repo();
  refused(fixture, CLEAN.replace("[src/a.ts]", "[src/gone.ts]"), /BAD_REVIEW.*src\/gone\.ts, which is not in the tree/);
  refused(fixture, CLEAN.replace("[src/a.ts]", "[.specs-inferno/state.yaml]"), /BAD_REVIEW.*the ledger is never part/);
});

test("a refused review file goes back to the reviewer, never to the orchestrator's pen", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, `${CLEAN}rest: x\n`);
  const result = review(fixture);
  assert.match(result.err, /send this back to the reviewer that wrote the file, then run the same command again/);
  assert.doesNotMatch(result.err, /Rewrite the file/);
});

// --- binding and recording -----------------------------------------------------------

test("a review binds exactly the paths it lists, never a same-named file in another folder", () => {
  const fixture = repo({ files: { "index.ts": "export {};\n", "docs/index.ts": "export {};\n" } });
  write(fixture.root, REVIEW, CLEAN.replace("[src/a.ts]", "[index.ts]"));
  assert.equal(review(fixture).code, 0);
  write(fixture.root, "docs/index.ts", "export const other = 1;\n");
  git(fixture.root, ["commit", "-qam", "another item changed its own index"]);

  const result = review(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /clean for the current files/);
});

test("recording a review commits only the review and the ledger", () => {
  const fixture = repo();
  write(fixture.root, "docs/b.md", "another item's staged work\n");
  git(fixture.root, ["add", "docs/b.md"]);
  write(fixture.root, REVIEW, CLEAN);

  assert.equal(review(fixture).code, 0);

  const committed = git(fixture.root, ["show", "--name-only", "--format=", "HEAD"]).split("\n");
  assert.deepEqual(committed.sort(), [".specs-inferno/intents/alpha/reviews/a-one.yaml", ".specs-inferno/state.yaml"]);
  assert.match(git(fixture.root, ["diff", "--cached", "--name-only"]), /docs\/b\.md/);
});

test("a fix review is owed again once a later commit touches the item's own paths", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FIX);
  review(fixture);
  write(fixture.root, "src/a2.test.ts", "// the test the finding asked for\n");
  git(fixture.root, ["add", "src/a2.test.ts"]);
  git(fixture.root, ["commit", "-qm", "the fix adds a test"]);

  const result = review(fixture);

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /paths src\/a\.ts src\/a2\.test\.ts/);
});

test("after the oracle decides, the fix review counts on the warm escalate builder", () => {
  const state = STATE.replace(
    /(- id: a-one[\s\S]*?status: pending)/,
    "$1\n        review: fix\n        review_tier: escalate\n        review_rejections: 2",
  );
  const fixture = repo({ state });
  write(fixture.root, REVIEW, FIX);

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(ledger(fixture), /review_tier: escalate/);
  assert.match(ledger(fixture), /review_rejections: 3/);
  assert.match(result.out, /next escalate model-escalate specsmd-inferno-builder-escalate: send every finding to the warm builder/);
});

test("the warm fix line carries the loop: commit and run review again", () => {
  const state = STATE.replace("        complexity: low\n", "        complexity: medium\n");
  const fixture = repo({ state });
  write(fixture.root, REVIEW, FIX);
  assert.match(review(fixture).out, /warm builder of a-one as one correction, then commit and run review again/);
});

test("on a host whose config names roles, the next line names that host's agent and model", () => {
  const codex = `roles:
  builder_cheap:
    agent: specsmd_inferno_builder_cheap
    model: codex-cheap
  builder_strong:
    agent: specsmd_inferno_builder_strong
    model: codex-strong
  builder_escalate:
    agent: specsmd_inferno_builder_escalate
    model: codex-strong
delivery:
  base_branch: main
`;
  const fixture = repo({ files: { ".specs-inferno/config.codex.yaml": codex } });
  write(fixture.root, REVIEW, FIX);
  const args = ["--config", ".specs-inferno/config.codex.yaml"];

  assert.match(review(fixture, args).out, /next strong codex-strong specsmd_inferno_builder_strong:/);
  const frontier = run(fixture, ["frontier", "alpha", ...args]).out;
  assert.match(frontier, /^ready a-one low behavior strong codex-strong$/m);

  const state = ledger(fixture).replace("review_tier: cheap", "review_tier: strong").replace("review_rejections: 1", "review_rejections: 2");
  fs.writeFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), state);
  git(fixture.root, ["commit", "-qam", "two strong rejections"]);
  assert.match(review(fixture, args).out, /next escalate codex-strong specsmd_inferno_builder_escalate: a fresh builder/);
});

// A Codex host declares itself. A role its config leaves out falls back to the agent the
// flow's own Codex agent file defines, never to a Claude agent name.
const CODEX_HOST = `host: codex
roles:
  builder_cheap:
    agent: specsmd_inferno_builder_cheap
    model: codex-cheap
  builder_strong:
    agent: specsmd_inferno_builder_strong
    model: codex-strong
delivery:
  base_branch: main
`;

test("a Codex host with no oracle or escalate role names the Codex agents on both rungs", () => {
  const fixture = repo({ files: { ".specs-inferno/config.codex.yaml": CODEX_HOST } });
  const args = ["--config", ".specs-inferno/config.codex.yaml"];
  const owed = review(fixture, args).out;
  assert.match(owed, /^dispatch specsmd_inferno_reviewer item a-one$/m);
  write(fixture.root, REVIEW, FIX);
  review(fixture, args);
  const rung = (tier, rejections) => {
    const state = ledger(fixture)
      .replace(/review_tier: \w+/, `review_tier: ${tier}`)
      .replace(/review_rejections: \d+/, `review_rejections: ${rejections}`);
    fs.writeFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), state);
    git(fixture.root, ["commit", "-qam", `${tier} rejected ${rejections} time(s)`]);
    const out = review(fixture, args).out + run(fixture, ["frontier", "alpha", ...args]).out;
    const payload = JSON.parse(review(fixture, [...args, "--json"]).out);
    assert.doesNotMatch(out, /specsmd-inferno-/);
    return { out, agent: payload.next.agent };
  };

  const escalate = rung("strong", 2);
  assert.match(escalate.out, /^next escalate specsmd_inferno_builder_escalate: a fresh builder takes a-one over/m);
  assert.equal(escalate.agent, "specsmd_inferno_builder_escalate");
  const oracle = rung("escalate", 2);
  assert.match(oracle.out, /^next oracle specsmd_inferno_oracle: ask it about a-one/m);
  assert.equal(oracle.agent, "specsmd_inferno_oracle");
});

test("the Codex fallback names are the agents the flow's own Codex agent files define", () => {
  const agents = path.join(__dirname, "..", "..", "..", "..", "..", "codex", "agents");
  for (const actor of ["cheap", "strong", "escalate", "oracle"]) {
    const { agent } = hostActor(actor, { host: "codex" });
    const toml = fs.readFileSync(path.join(agents, `${agent}.toml`), "utf8");
    assert.match(toml, new RegExp(`^name = "${agent}"$`, "m"));
  }
});

test("every frontier and review call in the Codex procedure reads the Codex config", () => {
  const procedure = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "..", "codex", "skills", "specsmd-inferno", "references", "procedure.md"),
    "utf8",
  );
  const calls = procedure.match(/`run\.cjs (?:frontier|review) [^`]*`/g) || [];
  assert.ok(calls.length >= 2, calls.join("\n"));
  for (const call of calls) assert.match(call, /--config \.specs-inferno\/config\.codex\.yaml/, call);
});

// --- the cutover is per host -------------------------------------------------------------

test("a host lock's review cutover exempts an item completed before it and holds one after", () => {
  const completed = (at) => STATE.replace(
    /(- id: a-one[\s\S]*?)status: pending/,
    `$1status: completed\n        completed_at: ${at}\n        integrated_sha: abc1234`,
  );
  assert.equal(run(repo({ state: completed("2026-09-10T00:00:00Z") }), ["frontier", "alpha"]).code, 0);
  assert.equal(run(repo({ state: completed("2026-09-30T00:00:00Z") }), ["frontier", "alpha"]).code, 3);
});

test("a host with no review cutover in its lock owes a review for every item and names a reinstall", () => {
  const state = STATE.replace(
    /(- id: a-one[\s\S]*?)status: pending/,
    "$1status: completed\n        completed_at: 2026-01-01T00:00:00Z\n        integrated_sha: abc1234",
  );
  const result = run(repo({ state, lock: null }), ["frontier", "alpha"]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /HELD a-one: completed with no clean item review/);
  assert.match(result.out, /reinstall/);
});
