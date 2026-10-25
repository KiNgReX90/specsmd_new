const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { repo, run, write } = require("./review-fixture.cjs");
const { SLICE_WORDS, planSlices } = require("./run-scan-slices.cjs");

// The plan-time scan splits a plan into disjoint slices of work items, one scanner each, so
// every scanner can be exhaustive within its slice and one round finds the whole set of gaps.

const CLAUDE_ROLE = ".claude/agents/specsmd-inferno-scanner.md";
const CODEX_ROLE = ".codex/agents/specsmd_inferno_scanner.toml";
const CODEX = ".specs-inferno/config.codex.yaml";
const INSTALLED = { [CLAUDE_ROLE]: "---\nname: specsmd-inferno-scanner\n---\n", [CODEX_ROLE]: 'name = "specsmd_inferno_scanner"\n' };
const PLAN = ".specs-inferno/intents/beta";

/** An item of about `words` words, depending on the items it names. */
function item(id, words, depends = []) {
  const body = Array.from({ length: words }, (_, index) => `w${index}`).join(" ");
  return `---\nid: ${id}\ntitle: "${id}"\nintent: beta\nstatus: pending\ndepends_on: [${depends.join(", ")}]\n---\n\n# Work Item: ${id}\n\n${body}\n`;
}

/** A host whose beta plan is a chain of six large items, listed out of order on disk. */
function bigPlan(options = {}) {
  const half = Math.floor(SLICE_WORDS / 2);
  const chain = ["b-one", "b-two", "b-three", "b-four", "b-five", "b-six"];
  const files = { ...INSTALLED, ...(options.files || {}), [`${PLAN}/brief.md`]: "# Intent: Beta\n" };
  chain.forEach((id, index) => {
    files[`${PLAN}/work-items/${id}.md`] = item(id, half, index === 0 ? [] : [chain[index - 1]]);
  });
  return { fixture: repo({ files }), chain };
}

const scan = (fixture, args) => run(fixture, ["scan", "--tree", fixture.root, ...args]);
const PLAN_ARGS = ["--only", "wiring", "--plan", "beta"];
const dispatchLines = (out) => [...out.matchAll(/^dispatch (\S+)(?: model \S+)? scan (\S+) brief (\S+)$/gm)];
const LINE = (claim) => `  - file: src/a.ts\n    line: 1\n    claim: ${claim}\n    proof: "rg -n producer src"\n`;
const answer = (brief, lines = "") =>
  write(path.dirname(brief), path.basename(brief).replace(/\.md$/, ".yaml"), `question: wiring\nlines:${lines ? `\n${lines}` : " []\n"}`);

test("planSlices covers every item exactly once, keeps a chain in order and holds each slice to the word budget", () => {
  const { fixture, chain } = bigPlan();
  const slices = planSlices(fixture.root, "beta");
  assert.ok(slices.length >= 3, JSON.stringify(slices));
  assert.deepEqual(slices.flatMap((slice) => slice.items), chain);
  for (const slice of slices) assert.ok(slice.items.length === 1 || slice.words <= SLICE_WORDS, JSON.stringify(slice));
});

test("planSlices gives an item larger than the budget a slice of its own", () => {
  const files = {
    [`${PLAN}/brief.md`]: "# Intent: Beta\n",
    [`${PLAN}/work-items/b-huge.md`]: item("b-huge", SLICE_WORDS * 2),
    [`${PLAN}/work-items/b-small.md`]: item("b-small", 10),
  };
  const slices = planSlices(repo({ files }).root, "beta");
  assert.deepEqual(slices.map((slice) => slice.items), [["b-huge"], ["b-small"]]);
});

test("the plan-time scan prints one dispatch line per slice, each with its own brief and result, to spawn in one message", () => {
  const { fixture, chain } = bigPlan();
  const result = scan(fixture, PLAN_ARGS);
  assert.equal(result.code, 3, result.out + result.err);
  const lines = dispatchLines(result.out);
  assert.ok(lines.length >= 3, result.out);
  assert.match(result.out, new RegExp(`^spawn these ${lines.length} in one message$`, "m"));
  assert.doesNotMatch(result.out, /once they return/);
  const briefs = lines.map((line) => line[3]);
  assert.equal(new Set(briefs).size, briefs.length);
  const owned = briefs.map((brief) => {
    const text = fs.readFileSync(brief, "utf8");
    assert.match(text, /question wiring/);
    assert.match(text, /exhaustive/i);
    assert.doesNotMatch(text, /handful|at most \d|stop after/i);
    assert.match(text, new RegExp(`result ${brief.replace(/\.md$/, ".yaml").replace(/[.]/g, "\\.")}`));
    const slice = /^- slice: (.+)$/m.exec(text);
    assert.ok(slice, text);
    return slice[1].split(", ").map((rel) => path.basename(rel, ".md"));
  });
  assert.deepEqual(owned.flat().sort(), [...chain].sort());
});

test("on Codex the plan-time slices are spawned three to a message", () => {
  const { fixture } = bigPlan({ files: { [CODEX]: "roles:\n  scanner:\n    model: model-codex-scan\n" } });
  const result = scan(fixture, [...PLAN_ARGS, "--config", CODEX]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.ok(dispatchLines(result.out).length > 3, result.out);
  assert.match(result.out, /^spawn these 3 in one message$/m);
  assert.match(result.out, /^once they return, spawn /m);
});

test("collect exits 3 while any slice's result is missing, then merges every slice with GAP ids unique across slices", () => {
  const { fixture } = bigPlan();
  const briefs = dispatchLines(scan(fixture, PLAN_ARGS).out).map((line) => line[3]);
  const [first, second, ...rest] = briefs;
  answer(first, LINE("first slice gap"));
  answer(second, `${LINE("second slice gap")}${LINE("second slice other gap")}`);
  const waiting = scan(fixture, ["--collect", ...PLAN_ARGS]);
  assert.equal(waiting.code, 3, waiting.out + waiting.err);
  for (const brief of rest) assert.match(waiting.out, new RegExp(brief.replace(/\.md$/, ".yaml").replace(/[.]/g, "\\.")));
  assert.doesNotMatch(waiting.out, new RegExp(first.replace(/\.md$/, ".yaml").replace(/[.]/g, "\\.")));
  for (const brief of rest) answer(brief);
  const gaps = scan(fixture, ["--collect", ...PLAN_ARGS]);
  assert.equal(gaps.code, 2, gaps.out + gaps.err);
  const ids = [...gaps.out.matchAll(/^GAP (\S+) /gm)].map((match) => match[1]);
  assert.deepEqual(ids, ["wiring-1", "wiring-2", "wiring-3"]);
  assert.match(gaps.out, /GAP wiring-3 src\/a\.ts:1: second slice other gap/);
});

test("a refused slice result names that slice's scanner", () => {
  const { fixture } = bigPlan();
  const briefs = dispatchLines(scan(fixture, PLAN_ARGS).out).map((line) => line[3]);
  for (const brief of briefs) answer(brief);
  const bad = briefs[1].replace(/\.md$/, ".yaml");
  write(path.dirname(bad), path.basename(bad), "question: contract\nlines: []\n");
  const refused = scan(fixture, ["--collect", ...PLAN_ARGS]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /question must be wiring/);
  assert.match(refused.err, /the wiring-2 scanner/);
});

test("collect refuses results when the plan's items changed since the dispatch", () => {
  const { fixture } = bigPlan();
  const briefs = dispatchLines(scan(fixture, PLAN_ARGS).out).map((line) => line[3]);
  for (const brief of briefs) answer(brief);
  write(fixture.root, `${PLAN}/work-items/b-seven.md`, item("b-seven", 10, ["b-six"]));
  const moved = scan(fixture, ["--collect", ...PLAN_ARGS]);
  assert.equal(moved.code, 3, moved.out + moved.err);
  assert.match(moved.out, /b-seven/);
  assert.match(moved.out, /run\.cjs scan --only wiring --plan beta/);
});

test("a fresh plan-time dispatch drops every result of the last one", () => {
  const { fixture } = bigPlan();
  const briefs = dispatchLines(scan(fixture, PLAN_ARGS).out).map((line) => line[3]);
  for (const brief of briefs) answer(brief);
  scan(fixture, PLAN_ARGS);
  const waiting = scan(fixture, ["--collect", ...PLAN_ARGS]);
  assert.equal(waiting.code, 3, waiting.out + waiting.err);
  assert.match(waiting.out, /waiting on/);
});

test("the scanner role is exhaustive within its range or slice and caps nothing", () => {
  const role = fs.readFileSync(path.resolve(__dirname, "../../../../scanner/agent.md"), "utf8");
  assert.match(role, /Be exhaustive within your range or slice/);
  assert.match(role, /no cap on lines/);
  assert.match(role, /your slice of its work items/);
  assert.doesNotMatch(role, /handful|at most \d|stop after|a few lines/i);
});
