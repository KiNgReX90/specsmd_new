const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { nextActor } = require("./run-review.cjs");
const { STATE, git, repo, run, write } = require("./review-fixture.cjs");

// --- only a serious rejection climbs ------------------------------------------------
// A fix review counts toward the ladder only when a finding is blocker or major, or a mutant
// survived. A minor-only one stays with the warm builder of the same tier, and a finding that
// repeats an earlier round goes to the oracle whatever the count.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const ledger = (fixture) => fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8");
const review = (fixture, args = []) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, "--reviewer", "rev-1", ...args]);

const finding = (extra) => `  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: read src/a.ts, it exports 1
    fix: export 2
${extra}`;
const fixReview = (...findings) => `item: a-one\nverdict: fix\nfiles: [src/a.ts]\nfindings:\n${findings.join("")}`;
const MINOR = finding("    severity: minor\n");
const MAJOR = finding("    severity: major\n");

const refused = (fixture, body, pattern) => {
  write(fixture.root, REVIEW, body);
  const result = review(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, pattern);
  assert.doesNotMatch(ledger(fixture), /review:/);
};

test("a finding without a severity, or with another value, is refused and the refusal names the three", () => {
  const fixture = repo();
  refused(fixture, fixReview(finding("")), /BAD_REVIEW.*findings entry 1 severity reads nothing.*blocker.*major.*minor.*send this back/);
  refused(fixture, fixReview(finding("    severity: low\n")), /BAD_REVIEW.*severity reads low; it must be blocker/);
  refused(fixture, fixReview(finding("    severity:\n")), /BAD_REVIEW.*severity reads nothing; it must be blocker.*major.*minor/);
  refused(fixture, fixReview(finding("    severity: [major]\n")), /BAD_REVIEW.*severity reads a list; it must be blocker/);
});

test("repeat holds true or is left out", () => {
  const fixture = repo();
  refused(fixture, fixReview(finding("    severity: minor\n    repeat: maybe\n")), /BAD_REVIEW.*repeat reads maybe.*write repeat: true/);
  refused(fixture, fixReview(finding("    severity: minor\n    repeat:\n")), /BAD_REVIEW.*repeat reads nothing.*write repeat: true/);
  refused(fixture, fixReview(finding("    severity: minor\n    repeat: [true]\n")), /BAD_REVIEW.*repeat reads a list.*write repeat: true/);
});

test("repeat: true on an item's first review is refused, since no earlier round reported anything", () => {
  refused(repo(), fixReview(finding("    severity: minor\n    repeat: true\n")), /BAD_REVIEW.*first review.*drop repeat: true.*send this back/);
});

test("a minor-only fix review leaves the count and names the warm builder of the same tier", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, fixReview(MINOR, MINOR));

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(ledger(fixture), /review_rejections: 0/);
  assert.match(ledger(fixture), /review_weight: minor/);
  assert.match(result.out, /^next cheap model-cheap specsmd-inferno-builder-cheap: every finding is minor, so send them to the warm builder of a-one/m);
  assert.equal(run(fixture, ["frontier", "alpha"]).out.includes(result.out.split("\n").find((line) => line.startsWith("next "))), true);
});

test("a major finding beside minor ones counts and climbs as today", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, fixReview(MINOR, MAJOR));
  const result = review(fixture);
  assert.match(ledger(fixture), /review_rejections: 1/);
  assert.match(result.out, /next strong model-strong specsmd-inferno-builder: a fresh builder takes a-one over/);
});

test("a blocker finding counts", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, fixReview(finding("    severity: blocker\n")));
  review(fixture);
  assert.match(ledger(fixture), /review_rejections: 1/);
});

test("a surviving mutant counts even when every finding is minor", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, `${fixReview(MINOR)}mutants:\n  - criterion: AC1\n    test: node --test src/a.test.ts\n    caught: no\n`);
  const result = review(fixture);
  assert.match(ledger(fixture), /review_rejections: 1/);
  assert.match(result.out, /next strong model-strong specsmd-inferno-builder: a fresh builder/);
});

test("a repeat finding goes to the oracle at any count, and the warm builder of its tier builds the decision", () => {
  const state = STATE.replace("        complexity: low\n", "        complexity: medium\n");
  const fixture = repo({ state });
  write(fixture.root, REVIEW, fixReview(MAJOR));
  review(fixture);
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the warm strong fix"]);
  write(fixture.root, REVIEW, fixReview(finding("    severity: minor\n    repeat: true\n")));

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(ledger(fixture), /review_rejections: 1/);
  assert.match(ledger(fixture), /review_weight: repeat/);
  assert.match(result.out, /^next oracle specsmd-inferno-oracle: a finding repeats an earlier round, so ask it about a-one .*warm strong builder/m);

  write(fixture.root, "src/a.ts", "export const a = 3;\n");
  git(fixture.root, ["commit", "-qam", "the oracle's decision, built warm"]);
  write(fixture.root, REVIEW, fixReview(MAJOR));
  review(fixture);
  assert.match(ledger(fixture), /review_tier: strong/);
  assert.match(ledger(fixture), /review_rejections: 2/);
  assert.match(ledger(fixture), /review_weight: serious/);
});

test("the ladder reads the weight of the last fix review", () => {
  const at = (tier, n, weight) => nextActor({ complexity: "high", review: "fix", review_tier: tier, review_rejections: n, review_weight: weight });
  assert.deepEqual(at("escalate", 2, "minor"), { actor: "escalate", agent: "specsmd-inferno-builder-escalate", fresh: false, rejections: 2 });
  assert.equal(at("escalate", 2, "serious").actor, "oracle");
  assert.equal(at("cheap", 1, "minor").actor, "cheap");
  assert.equal(at("cheap", 1, "serious").actor, "strong");
  assert.deepEqual(at("cheap", 0, "repeat"), { actor: "oracle", agent: "specsmd-inferno-oracle", fresh: false, rejections: 0 });
  assert.equal(at("strong", 1, "repeat").actor, "oracle");
  assert.equal(at("strong", 2, undefined).actor, "escalate", "a ledger written before the weight climbs as before");
});
