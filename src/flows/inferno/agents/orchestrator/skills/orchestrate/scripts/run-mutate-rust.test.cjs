const assert = require("node:assert/strict");
const test = require("node:test");

// A switch keeps the file's meaning while it is off only when it wraps a whole expression or a
// whole statement in a place a value can stand. Anything else takes the classic in-place build.
// These cases pin which mistakes share the build and which go on their own.

const { blame, planRust, switchText } = require("./run-mutate-rust.cjs");

/** Plan one entry: `find` on the last line of `lines`, at its `nth` occurrence there. */
function plan(lines, find, replace = "X", nth = 0) {
  const all = Array.isArray(lines) ? lines : [lines];
  const text = `${all.join("\n")}\n`;
  const line = all[all.length - 1];
  let col = -1;
  for (let i = 0; i <= nth; i += 1) col = line.indexOf(find, col + 1);
  const [result] = planRust(text, [{ k: 1, n: all.length, col, find, replace }]);
  return result.form === "switch" ? result.variant : `classic: ${result.why}`;
}

for (const [lines, find, expected] of [
  ["    a + b", "a + b", "expression"],
  ["pub fn f(a: u32, b: u32) -> u32 { a + b }", "a + b", "expression"],
  ["    if n >= 10 {", "n >= 10", "expression"],
  ["    x.len() > 0", "x.len()", "expression"],
  ["    let total = items.iter().sum::<u32>();", "items.iter().sum::<u32>()", "expression"],
  ["    let x: Vec<u8> = a + b;", "a + b", "expression"],
  ["    xs.iter().filter(|x| x.is_ok())", "x.is_ok()", "expression"],
  ["    self.count += 1;", "1", "expression"],
  ["    a - b - c", "a - b", "expression"],
  ["    return Err(e);", "Err(e)", "expression"],
  ["    Some(x) if x > 3 => 1,", "x > 3", "expression"],
  ["    total += x;", "total += x;", "statement"],
  ["    return a + b;", "return a + b;", "statement"],
  ["    2 * a + b", "a + b", /classic: .*parse/],
  ["    a - b - c", "b - c", /classic: .*parse/],
  ["    -x.abs()", "-x", /classic: .*parse/],
  ["    foo(&x)", "x", /classic: .*parse/],
  ["    x.push(1);", "x", /classic: .*parse/],
  ["    x[0] = 5;", "x", /classic: .*parse/],
  ["    x = 5;", "x", /classic: .*parse/],
  ["    if n >= 10 {", ">=", /classic: .*operator/],
  ["    let s = \"a camelCase b\";", "camelCase", /classic: .*whole tokens/],
  ["    let s = r#\"raw \"q\" a + b\"#;", "a + b", /classic: .*whole tokens/],
  ["    let y = f(x);", "let y = f(x);", /classic: .*let or an item/],
  ["    let y = f(x);", "f(x);", /classic: .*statement/],
  ["const MAX: u32 = 30;", "30", /classic: .*const or static/],
  ["pub static NAMES: [&str; 2] = [\"a\", \"b\"];", "\"b\"", /classic: .*const or static/],
  ["#[serde(rename_all = \"camelCase\")]", "\"camelCase\"", /classic: .*attribute/],
  [["#[cfg_attr(", "    test,", "    derive(Debug)"], "derive(Debug)", /classic: .*attribute/],
  ["    foo(a, b); // note", "foo(a, b); // note", /classic: .*line comment/],
  ["    foo(a, b)", "a, b", /classic: .*one expression/],
  [["/* a + b", "   a + b */"], "a + b", /classic: .*whole tokens/],
  ["    let c = 'x'; let d = a + b;", "a + b", "expression"],
  ["fn f<'a>(x: &'a str) -> usize { x.len() + 1 }", "x.len() + 1", "expression"],
]) {
  const name = Array.isArray(lines) ? lines.join(" / ") : lines;
  test(`${JSON.stringify(find)} in ${JSON.stringify(name)} plans ${expected}`, () => {
    const result = plan(lines, find);
    if (expected instanceof RegExp) assert.match(result, expected);
    else assert.equal(result, expected);
  });
}

test("two entries on one line both switch when their spans are apart, and an overlap goes on its own", () => {
  const text = "pub fn f() -> u32 { ONE + TEN }\n";
  const [one, ten, both] = planRust(text, [
    { k: 1, n: 1, col: text.indexOf("ONE"), find: "ONE", replace: "TWO" },
    { k: 2, n: 1, col: text.indexOf("TEN"), find: "TEN", replace: "SIX" },
    { k: 3, n: 1, col: text.indexOf("ONE + TEN"), find: "ONE + TEN", replace: "0" },
  ]);
  assert.equal(one.form, "switch");
  assert.equal(ten.form, "switch");
  assert.equal(both.form, "classic");
  assert.match(both.why, /overlaps entry 1/);
});

test("the switch reads INFERNO_MUTANT once per site through a block-local OnceLock", () => {
  const expression = switchText(3, "a + b", "a - b", "expression");
  assert.equal(expression, '(if { static INFERNO_SWITCH: ::std::sync::OnceLock<bool> = ::std::sync::OnceLock::new(); ' +
    '*INFERNO_SWITCH.get_or_init(|| ::std::env::var("INFERNO_MUTANT").map_or(false, |v| v == "3")) } { a - b } else { a + b })');
  assert.match(switchText(3, "x += 1;", "", "statement"), /^if \{ static .* \} \{ {2}\} else \{ x \+= 1; \}$/);
});

const RUSTC = `   Compiling fixture v0.1.0 (/tmp/x)
warning: unnecessary parentheses around block return value
 --> src/lib.rs:2:5
  |
2 |     (if { static INFERNO_SWITCH } { a } else { b })
  |     ^

error[E0277]: cannot multiply \`u32\` by \`&str\`
 --> src/lib.rs:9:7
  |
9 |     n * "2"
  |       ^ no implementation for \`u32 * &str\`

error[E0382]: borrow of moved value: \`v\`
  --> src/other.rs:14:20
   |
12 |     let w = (if { static INFERNO_SWITCH } { v } else { v });
   |                                                        - value moved here
13 |     let n = 1;
14 |     println!("{}", v.len());
   |                    ^ value borrowed here after move

error: could not compile \`fixture\` (lib test) due to 2 previous errors
`;

test("blame maps every compile error to the switched entries on the lines it names, primary or secondary", () => {
  const switched = [
    { k: 1, rel: "crate/src/lib.rs", n: 2 },
    { k: 2, rel: "crate/src/lib.rs", n: 9 },
    { k: 3, rel: "crate/src/other.rs", n: 12 },
    { k: 4, rel: "crate/src/other.rs", n: 20 },
  ];
  assert.deepEqual(blame(RUSTC, switched).sort(), [2, 3]);
});

test("blame takes the short message format too, and an error on no entry's line blames every switch in that file", () => {
  const switched = [{ k: 1, rel: "src/lib.rs", n: 3 }, { k: 2, rel: "src/lib.rs", n: 7 }, { k: 3, rel: "src/b.rs", n: 1 }];
  assert.deepEqual(blame("src/lib.rs:7:9: error[E0308]: mismatched types\nerror: could not compile `x`\n", switched), [2]);
  assert.deepEqual(blame("error[E0425]: cannot find value `y`\n --> src/lib.rs:5:9\n  |\n5 |     y\n", switched).sort(), [1, 2]);
  assert.deepEqual(blame("error[E0425]: oops\n --> src/elsewhere.rs:5:9\n", switched).sort(), [1, 2, 3]);
});
