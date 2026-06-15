# Intent: Add a tiny math library

Goal: a `lib/` with `add.js`, `mul.js`, and `calc.js` (calc(a,b) = add(a,b) * mul(a,b)),
each with a passing `node --test` test under `tests/`. CommonJS exports. No dependencies.
Success: `npm test` passes with 3 test files.
