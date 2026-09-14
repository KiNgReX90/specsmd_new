const assert = require("node:assert/strict");
const test = require("node:test");

const yaml = require("./run-yaml.cjs");

// --- quoted scalars ---------------------------------------------------------

test("a double-quoted scalar decodes an escaped quote", () => {
  const doc = yaml.parseYaml('finalize_check: "test -z \\"$(echo)\\""\n');
  assert.equal(doc.finalize_check, 'test -z "$(echo)"');
});

test("a double-quoted scalar decodes an escaped backslash", () => {
  const doc = yaml.parseYaml('finalize_check: "! git grep -n \\"a\\\\|b\\""\n');
  assert.equal(doc.finalize_check, '! git grep -n "a\\|b"');
});

test("a double-quoted scalar decodes a newline, a tab, a slash and a quote", () => {
  const doc = yaml.parseYaml('note: "one\\ntwo\\tthree\\/four\\\'five"\n');
  assert.equal(doc.note, "one\ntwo\tthree/four'five");
});

test("a single-quoted scalar decodes a doubled quote and nothing else", () => {
  const doc = yaml.parseYaml("note: 'it''s a\\nliteral'\n");
  assert.equal(doc.note, "it's a\\nliteral");
});

test("an escape the parser does not implement is a BAD_MANIFEST error naming the key", () => {
  assert.throws(
    () => yaml.parseYaml('finalize_check: "grep -E \\"^\\sfoo\\""\n'),
    (error) => {
      assert.equal(error.name, "RunError");
      assert.equal(error.code, "BAD_MANIFEST");
      assert.equal(error.exit, 2);
      assert.match(error.message, /finalize_check/);
      assert.match(error.message, /\\s/);
      return true;
    },
  );
});

// --- comments and inline lists ----------------------------------------------

test("a hash inside quotes is text and a trailing hash is still a comment", () => {
  const doc = yaml.parseYaml('a: "count #1 here"   # the tail comment\nb: plain # gone\n');
  assert.equal(doc.a, "count #1 here");
  assert.equal(doc.b, "plain");
});

test("a hash after an escaped quote stays inside the value", () => {
  const doc = yaml.parseYaml('a: "say \\"hi # keep\\""\n');
  assert.equal(doc.a, 'say "hi # keep"');
});

test("an inline list decodes every entry and splits outside quotes only", () => {
  const doc = yaml.parseYaml('paths: [a, "b # c", "d\\"e", \'f\'\'g\', "x, y"]\n');
  assert.deepEqual(doc.paths, ["a", "b # c", 'd"e', "f'g", "x, y"]);
  assert.deepEqual(yaml.parseYaml("depends_on: []\n").depends_on, []);
});

// --- the shapes the flow's own files carry ----------------------------------

test("maps, block lists, nested lists and block scalars still parse", () => {
  const doc = yaml.parseYaml(
    ["verification:", "  finalize:", "    - npm test", '    - "npm run check:secrets"', "  scopes:", '    "cargo test":', "      - src-tauri/**", "notes: |", "  one", "  two", ""].join("\n"),
  );
  assert.deepEqual(doc.verification.finalize, ["npm test", "npm run check:secrets"]);
  assert.deepEqual(doc.verification.scopes["cargo test"], ["src-tauri/**"]);
  assert.equal(doc.notes, "one\ntwo");
});

// --- nothing is parsed halfway ----------------------------------------------
// A header written `verification: # the cheap checks` used to read as an empty string, and
// the whole nested block under it, plus every key after it, fell out of the config with no
// error at all. A gate list nobody could see is a gate nobody runs.

test("a header with a trailing comment keeps its block and everything after it", () => {
  const doc = yaml.parseYaml(
    [
      "verification: # the cheap checks, about a minute",
      "  integrate:",
      "    - npm run check",
      "    - npm test",
      "  finalize:",
      "    - npm run build",
      "delivery:",
      "  base_branch: main",
      "",
    ].join("\n"),
  );
  assert.deepEqual(doc.verification.integrate, ["npm run check", "npm test"]);
  assert.deepEqual(doc.verification.finalize, ["npm run build"]);
  assert.equal(doc.delivery.base_branch, "main");
});

test("a line the parser cannot place stops the parse and names the line", () => {
  assert.throws(
    () => yaml.parseYaml("verification:\n  integrate:\n    - npm test\n  a line with no key\n"),
    (error) => {
      assert.equal(error.code, "BAD_YAML");
      assert.match(error.message, /a line with no key/);
      return true;
    },
  );
});
