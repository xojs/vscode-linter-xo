# VSCode Linter XO testing

Tests focus on integration at the server level, most unit test cases are covered by the server integration tests.

## TypeScript execution

Tests run with Node's test runner and use `tsx` only to execute TypeScript. The package is CommonJS while its TypeScript source uses ESM imports, and the source contains syntax such as enums and constructor parameter properties that Node cannot handle through type stripping alone. Native execution would currently require additional module boundaries and the experimental `--experimental-transform-types` flag.

Type checking remains a separate `npm run check` step because `tsx` does not type-check files. Remove `tsx` when Node can run this syntax without experimental flags across every supported CI version.
