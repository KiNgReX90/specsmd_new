const assert = require("node:assert/strict");
const test = require("node:test");

// A red run is a caught mistake only when the test ran and noticed it. A Rust build that failed and
// a JavaScript file that does not parse never reach the test, so they read no verdict. The texts
// below are what cargo, node --test, node and vitest (4.0 with esbuild, 4.1 with oxc and rolldown)
// print, cut down to the lines that decide.

const { verdictOf } = require("./run-mutate-verdict.cjs");

const ABS = "/w/app/src/s.ts";
const run = (code, extra = {}) => ({ code, signal: null, ...extra });

const CARGO_FAILED = "error[E0308]: mismatched types\n --> src/lib.rs:3:5\n\nerror: could not compile `fixture` (lib test) due to 1 previous error\n";
const CARGO_RED = "running 1 test\ntest tests::add ... FAILED\n\nfailures:\n\ntest result: FAILED. 0 passed; 1 failed\nerror: test failed, to rerun pass `--lib`\n";
const CARGO_KILLED = "running 1 test\nerror: test failed, to rerun pass `--lib`\n\nCaused by:\n  process didn't exit successfully: `/t/deps/fixture-1` (signal: 9, SIGKILL: kill)\n";

const NODE_CJS = `  /w/app/src/s.ts:1\n  module.exports = (if 1 { 2 });\n                    ^^\n  \n  SyntaxError: Unexpected token 'if'\n      at wrapSafe (node:internal/modules/cjs/loader:1743:18)\n`;
const NODE_ESM = `file:///w/app/src/s.ts:1\nexport const v = (if 1 { 2 });\n                  ^^\n\nSyntaxError: Unexpected token 'if'\n    at compileSourceTextModule (node:internal/modules/esm/utils:318:16)\n`;
const NODE_TS = `/w/app/src/s.ts:1\nexport const v: number = (if 1 { 2 });\n                          ^^\n\nSyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expression expected\n    at parseTypeScript (node:internal/modules/typescript:72:36)\n`;
const NODE_RUNTIME = `/w/app/src/s.ts:1\nmodule.exports = JSON.parse('{bad');\n                      ^\n\nSyntaxError: Expected property name or '}' in JSON at position 1\n    at JSON.parse (<anonymous>)\n    at Object.<anonymous> (/w/app/src/s.ts:1:23)\n`;
const VITEST_ESBUILD = ` FAIL  a.test.ts [ a.test.ts ]\nError: Transform failed with 1 error:\n/w/app/src/s.ts:1:26: ERROR: Unexpected "if"\n  Plugin: vite:esbuild\n  File: /w/app/src/s.ts:1:26\n`;
const VITEST_OXC = ` FAIL  a.test.ts [ a.test.ts ]\nError: Transform failed with 1 error:\n\n[PARSE_ERROR] Unexpected token\n   ╭─[ s.ts:1:27 ]\n───╯\n\n  Plugin: vite:oxc\n  File: /w/app/src/s.ts\n`;
const VITEST_ROLLDOWN = ` FAIL  j.test.ts [ j.test.ts ]\nRolldownError: Parse failure: Parse failed with 1 error:\nUnexpected token\nAt file: /src/s.ts:2:18\n  File: /src/s.ts:2:18\n`;
const VITEST_RUNTIME = ` FAIL  c.test.ts > two\nSyntaxError: runtime boom\n ❯ thrower src/s.ts:2:45\n`;
const VITEST_OTHER_FILE = ` FAIL  a.test.ts [ a.test.ts ]\nError: Transform failed with 1 error:\n  Plugin: vite:oxc\n  File: /w/app/src/other.ts\n`;

for (const [name, result, text, expected] of [
  ["a green run", run(0), "test result: ok", { caught: false }],
  ["a red cargo test", run(101), CARGO_RED, { caught: true }],
  ["a cargo build that failed", run(101), CARGO_FAILED, { caught: null, why: "did not build" }],
  ["a test binary the cap killed", run(101), CARGO_KILLED, { caught: null, why: /killed/ }],
  ["a run killed with exit 137", run(137), "", { caught: null, why: /killed \(exit 137\)/ }],
  ["a run that ended on a signal", run(1, { signal: "SIGTERM" }), "", { caught: null, why: /ended on SIGTERM/ }],
  ["node failing to parse the file under CommonJS", run(1), NODE_CJS, { caught: null, why: "did not parse" }],
  ["node failing to parse the file as a module", run(1), NODE_ESM, { caught: null, why: "did not parse" }],
  ["node failing to strip the file's types", run(1), NODE_TS, { caught: null, why: "did not parse" }],
  ["a SyntaxError the code throws while it runs", run(1), NODE_RUNTIME, { caught: true }],
  ["vitest with esbuild failing to transform the file", run(1), VITEST_ESBUILD, { caught: null, why: "did not parse" }],
  ["vitest with oxc failing to transform the file", run(1), VITEST_OXC, { caught: null, why: "did not parse" }],
  ["vitest with rolldown failing to parse the file", run(1), VITEST_ROLLDOWN, { caught: null, why: "did not parse" }],
  ["vitest reporting a SyntaxError a test threw", run(1), VITEST_RUNTIME, { caught: true }],
  ["vitest failing to transform another file", run(1), VITEST_OTHER_FILE, { caught: true }],
]) {
  test(`${name} reads ${expected.caught === null ? "no verdict" : `caught ${expected.caught ? "yes" : "no"}`}`, () => {
    const verdict = verdictOf(result, text, ABS);
    assert.equal(verdict.caught, expected.caught);
    if (expected.why instanceof RegExp) assert.match(verdict.why, expected.why);
    else if (expected.why) assert.equal(verdict.why, expected.why);
  });
}
