# XO error-handling improvement handoff

## Purpose

Make XO, ESLint, configuration, formatting, and request failures useful without allowing one failure to spam notifications, strand an LSP request, hide its root cause, or produce a secondary unhandled rejection.

This plan intentionally keeps the current architecture:

- XO continues to execute inside the LSP server.
- Configuration-file changes continue to restart the language client/server.
- The existing serial queues remain.
- No child process, worker thread, or scheduling redesign is included.

The repository baseline used for this investigation is commit `e150b9f` (`fix(server): refresh linting safely after configuration changes`). The diagnostic-coordinate fix that clamps zero-valued ESLint positions should remain intact.

## Current behavior and risks

### Background lint errors show a popup for every document/edit

`server/lint-document.ts` catches every `Error` and calls:

```ts
this.connection.window.showErrorMessage(error.message);
```

A single invalid config or broken plugin can therefore show the same notification once per open document and again as documents change. Restarting after a config save also reopens and relints documents, magnifying the noise.

### The actual cause of a configuration error is often hidden

Current XO wraps configuration failures with a generic error such as:

```text
Error resolving XO config, there is likely an issue with your config file.
```

The useful syntax/import/plugin error is commonly stored in `Error.cause`. `server/logger.ts` logs only `error.message` and `error.stack`, so the cause chain can be absent from both the popup and output channel.

### Errors are not classified by expectedness or user action

The server currently treats configuration errors, missing XO, plugin failures, cancellation, content-modified races, shutdown races, and extension defects similarly. Expected request races are sometimes logged at error level, while actionable config failures are shown without their root cause.

### Some LSP requests can remain unresolved

Several request handlers use an outer manually constructed promise. Some branches return from the inner function without resolving or rejecting the outer promise. Several catches reject only when the thrown value is an `Error`; JavaScript can throw any value.

Known examples in `server/server.ts`:

- Formatting returns without resolving when the document is no longer open.
- All-fixes catches only `Error` values.
- Formatting catches only `Error` values.
- Code actions catch only `Error` values.

An unresolved request can leave VS Code waiting indefinitely and make restart/shutdown behavior appear broken.

### Fix-all request errors escape the client handler

In `client/fix-all-problems.ts`, `client.sendRequest()` executes before the `try`. If XO throws during the request, the command rejects with a raw LSP/command error rather than the extension's concise message.

The function also treats the result as definitely present, and after detecting an outdated document version it currently continues toward applying the edits.

### Expected content races are logged as server failures

Formatting throws an LSP `ContentModified` response when the document changes while formatting. That is normal editor behavior. Its catch logs it with `logError()` before returning it to the client.

Cancellation should likewise not be reported as an XO/server failure.

### Error cleanup can hide the original failure

After catching an XO failure, `lintDocument()` awaits `sendDiagnostics()` to clear diagnostics. If the connection is closing during restart, that cleanup call can reject from inside the catch. A secondary transport error may then escape while the original XO error is lost.

### Unknown thrown values disappear

If XO or a plugin throws a string, object, `null`, or another non-`Error` value, several catches do nothing. The operation may remain unresolved and no useful detail reaches the output channel.

### Logging itself is not fully defensive

`server/logger.ts` uses `JSON.stringify()` for arbitrary objects. Circular structures can throw while attempting to log an existing failure. Native `Error` objects also stringify poorly. Error reporting should not be able to become the next error.

### True process crashes remain possible

Ordinary synchronous and promise-based XO exceptions can be handled. A native crash, out-of-memory condition, uncaught asynchronous exception, plugin calling `process.exit()`, or similar process-level failure terminates the LSP server. This plan does not isolate those failures; it focuses on ensuring all recoverable failures are contained and explained.

## Desired user experience

### Background linting

- Clear stale fixes and suggestions immediately after lint failure.
- Clear diagnostics safely so old results are not presented as current.
- Log the complete error and cause chain every time useful for debugging.
- Show at most one concise notification for the same root/error during one server session.
- Do not show raw stacks or deeply nested errors in notifications.
- Recover automatically on the next successful lint or server restart.

Example notification:

```text
XO could not load the configuration for this workspace. See the XO output for details.
```

Example output detail:

```text
[server] XO lint failed for /workspace/src/file.ts
Error: Error resolving XO config...
Caused by: SyntaxError: Unexpected token ...
    at ...
```

### Formatting and fix-all

These are explicit user actions, so failure should produce one concise message. Full details belong in the output channel. Expected cancellation or document-version changes should use normal protocol responses rather than alarming server-error logs.

### Code actions

Code-action discovery is background UI work. Failure should generally return no actions, log the detail, and reuse the same deduplicated notification policy if the underlying XO configuration is broken. It should not create repeated VS Code request-failed popups.

## Error categories and handling policy

| Category | Examples | Notification | Logging | Protocol result |
| --- | --- | --- | --- | --- |
| Configuration | Syntax error, failed import, missing config dependency | Once per root/error | Full cause chain | Empty diagnostics/actions or concise request error |
| XO resolution | XO missing, invalid `xo.path`, no `lintText` export | Once per root/error | Resolution context and cause | Empty diagnostics or concise request error |
| Plugin/parser runtime | Rule throws, parser initialization failure | Once per root/error signature | Full cause chain and document | Clear affected state; explicit requests fail concisely |
| Document race | Content modified, closed document | None | Debug at most | Empty result or `ContentModified` |
| Cancellation | Cancellation token requested | None | Debug at most | `RequestCancelled` |
| Shutdown/connection | Diagnostic send after connection closes | None | Debug at most | Best-effort cleanup |
| Internal extension defect | Invalid assumptions, unexpected state | Once per signature | Full stack/context | Safe empty result or internal error |
| Unknown thrown value | String/object/null thrown by plugin | Same as classified normalized error | Inspected value | Always settle request |

Do not classify solely for cosmetic purposes. The minimum useful classification is: expected LSP control flow, actionable XO/configuration failure, and unexpected extension failure.

## Central error normalization and logging

### Modify: `server/logger.ts`

Add a small, reusable normalization boundary. This is justified because linting, formatting, all-fixes, code actions, and queue handlers all receive `unknown` errors.

Suggested operations:

```ts
function toError(value: unknown): Error;
function formatError(error: Error): string;
function logError(this: LintServer, error: unknown, context?: string): void;
```

Requirements:

1. Return existing `Error` objects unchanged.
2. Convert primitive thrown values to an `Error` using `String(value)`.
3. Use `node:util.inspect()` for thrown objects that cannot be safely stringified.
4. Walk `Error.cause` recursively.
5. Prevent infinite loops with a `Set` of visited causes.
6. Include each error's name, message, and stack without duplicating identical stack headers.
7. Never throw while formatting or logging an error.
8. Accept optional context such as operation, document URI, and workspace/root.
9. Stop mutating the original error message in `lintDocument()` when appending installation advice.

Keep notification text separate from detailed log text. The raw error is for output; the summary is for the user.

### Consider a focused new file: `server/errors.ts`

If cause formatting and classification make `logger.ts` difficult to read, place these domain operations in `server/errors.ts`:

- `toError()`
- `formatErrorChain()`
- `isExpectedLspError()`
- `getXoErrorSummary()`
- `getErrorFingerprint()`

Do not create a hierarchy of custom error classes. Existing `Error`, `ResponseError`, `cause`, and small classification functions are sufficient.

## Notification deduplication

### Modify: `server/server.ts`

Replace the unused `hasShownResolutionError` boolean with a set of error fingerprints, for example:

```ts
shownErrorNotifications: Set<string>;
```

A fingerprint should include:

- Broad category.
- Workspace/root context when already available.
- Normalized top-level and cause messages.

Do not include the document URI for project-wide configuration failures, or every open document will produce a different fingerprint.

Provide one server-level operation that:

1. Normalizes and logs the error with context.
2. Returns immediately for cancellation, content-modified, or shutdown errors.
3. Computes a concise user summary.
4. Shows the summary only if its fingerprint has not been shown.

The set naturally resets when a filesystem config change restarts the LSP process. Clear it in `handleDidChangeConfiguration()` for in-process VS Code setting changes so a corrected and later-broken configuration can be reported again.

Do not wait on the notification promise as part of the lint queue. Notification failure must not make lint failure handling fail.

## Background lint handling

### Modify: `server/lint-document.ts`

Refactor the catch path so it cannot throw while handling the original failure:

1. Delete the document's fix and suggestion caches.
2. Attempt to clear diagnostics in a nested best-effort `try/catch`.
3. Ignore or debug-log diagnostic-send failure when shutdown has begun.
4. Normalize and report the original XO error through the server-level reporter.
5. Ensure `lintDocument()` resolves after handling the failure.

Keep the existing behavior that clears stale diagnostics. Retaining last-known-good diagnostics would require explicitly representing their stale state, which this extension does not currently do. Clearing is safer than allowing obsolete diagnostics and fixes to look current.

On successful lint, continue replacing diagnostics and caches normally. Do not reset global notification fingerprints after every successful document because another root/document may still be failing.

### Modify: `server/get-lint-results.ts`

The no-root case currently constructs and logs an `Error` for a condition described as expected. Downgrade it to a concise debug/info message, return the empty report, and avoid repeated stack output.

Continue restoring `process.cwd()` in `finally`.

Do not catch XO errors here unless adding operation/root context through `cause`; `lintDocument()` and explicit request handlers need to decide how the failure should affect their protocol response.

## LSP request settlement

### Modify: `server/server.ts`

Every request path must resolve or reject exactly once.

### `handleAllFixesRequest()`

- Resolve the formatting result when available.
- Resolve `undefined` only when that is an intentional protocol outcome.
- Normalize and reject every thrown value, not only `Error` instances.
- Log/report the underlying XO failure once.
- Ensure the queue callback always completes.

`getDocumentFormatting()` currently returns a `DocumentFix`, so verify whether the `undefined` branch is still reachable and remove it if not.

### `handleDocumentFormattingRequest()`

- Resolve `[]` when the document is closed or unavailable.
- Return `RequestCancelled` without error-level logging.
- Return `ContentModified` without error-level logging.
- For XO/configuration failures, log the full cause and reject with a concise `ResponseError` rather than exposing the raw exception.
- Normalize non-`Error` thrown values.
- Ensure the outer promise always settles.

### `handleCodeActionRequest()`

- Preserve cancellation as `RequestCancelled` without error logging.
- Resolve `undefined` or an empty action list when background action calculation cannot proceed because the document closed.
- Normalize every thrown value.
- For an XO/configuration failure while calculating fix-all edits, log/report it and return no action rather than generating repetitive raw request-failed messages.
- Ensure the outer promise always settles.

### Queue wrappers

Every detached async call currently written as `void operation().finally(done)` should have a final rejection path or call an operation that guarantees it never rejects. A rejection from cleanup or logging must not become an unhandled promise rejection.

Where practical, let the `queue` package observe a returned promise instead of manually detaching it. Do not broadly rewrite queue architecture during this task; make only the changes needed to guarantee completion and error containment.

## Client fix-all handling

### Modify: `client/fix-all-problems.ts`

Move all of the following inside one `try`:

- `client.sendRequest()`
- Result validation.
- Document-version validation.
- Edit conversion and application.

On failure:

1. Log the original error to the XO output channel or through `client.error(..., false)` without forcing another popup.
2. Show one concise fix-all failure message.
3. Do not expose the raw LSP exception to VS Code's command dispatcher.

If the response is missing or malformed, treat it as a normal command failure with details in output.

If the active document version no longer matches the response version, show the existing informational message and return immediately. Do not continue applying stale edits.

Avoid showing the same failure twice when `applyTextEdits()` already reported it. Prefer one function owning the user-facing message.

## Expected LSP errors

Use a small predicate rather than scattered message checks:

```ts
function isExpectedLspError(error: Error): boolean
```

It should recognize `ResponseError` codes for at least:

- `LSPErrorCodes.RequestCancelled`
- `LSPErrorCodes.ContentModified`

Expected errors may be returned to the client but should not be passed to error-level logging or notification deduplication.

Do not suppress an arbitrary error merely because its text contains words such as "cancelled" or "modified"; prefer typed/code-based checks.

## Server lifecycle and genuine crashes

### Modify: `client/extension.ts` only if evidence requires it

The language client already owns server-connection failure behavior. Do not add a new custom restart policy in the first error-handling pass.

Ensure existing restart failures remain logged once and do not leak rejected promises from filesystem callbacks. That was addressed in commit `e150b9f`.

If real crash loops are later observed, add a bounded custom close/error handler with backoff. Do not preemptively duplicate `vscode-languageclient` restart behavior.

## Logging levels and content

Use these conventions:

- `debug`: cancellation, stale document, closed document, expected shutdown race.
- `info`: server/restart lifecycle and no-XO-root skip.
- `warn`: recoverable malformed result or one-time plugin/config issue if lint can continue.
- `error`: actionable XO/configuration failure or extension defect, with full cause chain.

Never log complete document contents, complete environment variables, or arbitrary configuration secrets. Absolute file paths are acceptable in the local XO output channel when needed to identify a failing config/plugin.

## Tests

### New file: `test/errors.test.ts`

Test the central error boundary:

- `toError()` preserves an `Error`.
- String and object throws become useful errors.
- Circular thrown objects do not crash formatting.
- A nested `cause` chain appears in output.
- Circular cause chains terminate safely.
- Expected `ResponseError` codes are recognized.
- Fingerprints are stable for the same root/error and distinct for meaningfully different failures.

### Modify: `test/lsp/document-sync.test.ts`

Add background lint failure coverage:

- Fix and suggestion caches are cleared.
- Diagnostics are cleared after XO failure.
- Repeated identical failures generate one notification.
- Full details are still logged for repeated failures.
- A failure while clearing diagnostics does not make `lintDocument()` reject or hide the original log.
- Non-`Error` throws are normalized and reported.

Use meaningful integration-style calls through `lintDocument()` rather than exporting internal helpers solely for tests.

### New or existing LSP request tests

Add cases for:

- Formatting a closed document resolves `[]` promptly.
- Formatting cancellation returns `RequestCancelled` and is not error-logged.
- Document-version mismatch returns `ContentModified` and is not error-logged.
- XO formatting failure logs the cause and rejects with a concise protocol error.
- Non-`Error` throws reject instead of hanging.
- All-fixes always settles after failure.
- Code-action calculation always settles after failure.

A test should use a timeout or race so a regression that leaves a promise unresolved fails quickly and clearly.

### Client fix-all testing

If importing the client module under Node remains impractical because of the `vscode` dependency, keep the client change small and verify it manually in an Extension Development Host. Do not export private production helpers merely to unit test them.

Manual cases:

1. Run fix-all while XO configuration is invalid.
2. Run fix-all, edit the document before the response, and verify no stale edits apply.
3. Close the document during formatting.
4. Cancel formatting.
5. Trigger a plugin exception and verify one concise notification plus full output details.

### Integration fixture for nested XO causes

In `test/integration/lint-flow.test.ts` or a focused integration file:

1. Create a temporary XO config importing a missing module or containing invalid syntax.
2. Lint two open documents.
3. Assert diagnostics are cleared for both.
4. Assert one user notification is requested.
5. Assert output contains the underlying import/syntax cause.
6. Repair the config/recreate the server as normal config restart would, then verify lint recovery.

## Implementation order

1. Add unknown-error normalization and recursive cause formatting in `server/logger.ts` or `server/errors.ts`.
2. Add tests for primitive/object throws, nested causes, and cycle safety.
3. Replace `hasShownResolutionError` with fingerprint-based notification deduplication in `server/server.ts`.
4. Route `lintDocument()` failures through the centralized reporter and make diagnostics cleanup best effort.
5. Downgrade the expected no-root path in `get-lint-results.ts` from stack-bearing error logging.
6. Audit and fix all-fixes, formatting, and code-action request settlement in `server/server.ts`.
7. Suppress error-level logging for typed cancellation and content-modified responses.
8. Move the complete fix-all client flow inside its error boundary and return after version mismatch.
9. Add request-settlement and duplicate-notification integration tests.
10. Run `npm run check`, `npm run lint`, `npm test`, and `npm run build`.
11. Test invalid config, missing plugin, thrown rule, cancellation, formatting race, and fix-all manually in an Extension Development Host.

## Files expected to change

| File | Planned responsibility |
| --- | --- |
| `server/logger.ts` | Normalize unknown throws and log complete, cycle-safe cause chains. |
| `server/errors.ts` | Optional focused home for classification, summaries, and fingerprints if logger becomes crowded. |
| `server/server.ts` | Notification deduplication, request settlement, expected-error handling, queue containment. |
| `server/lint-document.ts` | Best-effort cleanup and centralized background lint reporting. |
| `server/get-lint-results.ts` | Stop treating expected no-root skips as stack-bearing failures. |
| `client/fix-all-problems.ts` | Catch request failures, validate responses, and never apply stale edits. |
| `test/errors.test.ts` | Error normalization, cause formatting, classification, and fingerprint tests. |
| `test/lsp/document-sync.test.ts` | Background lint cleanup, deduplication, and cleanup-failure behavior. |
| `test/lsp/code-actions.test.ts` | Code-action request settlement and expected failure behavior. |
| `test/integration/lint-flow.test.ts` | Invalid config/plugin cause visibility and multi-document deduplication. |
| `CHANGELOG.md` | Record reduced notification spam and improved error detail/recovery. |

## Non-goals

- Do not add a child process or worker thread.
- Do not redesign the existing queue.
- Do not retain stale fixes or suggestions after a lint failure.
- Do not add a large custom error-class hierarchy.
- Do not parse stack traces to classify errors.
- Do not expose raw internal errors in user notifications.
- Do not silently swallow actionable errors; full detail must reach the output channel.
- Do not add telemetry or remote reporting.
- Do not attempt to recover from native crashes or out-of-memory termination inside the same process.

## Acceptance criteria

- One invalid XO configuration does not produce one popup per document or keystroke.
- The XO output includes the deepest available syntax/import/plugin cause and stack.
- Background lint failures clear stale diagnostics, fixes, and suggestions without throwing a secondary cleanup error.
- Cancellation and content-modified races do not appear as server errors.
- Every all-fixes, formatting, and code-action request resolves or rejects exactly once for every thrown value.
- Fix-all request failures are caught by the extension and do not escape as raw command failures.
- Fix-all never applies edits to a newer document version.
- Unknown and circular thrown values cannot crash error logging.
- Correcting a configuration restores normal linting without reloading the VS Code window beyond the existing configured server restart.
- Genuine extension defects remain visible in the output channel with enough context to debug.
- Existing diagnostics, formatting, fixes, suggestions, restart behavior, and multi-root support continue to pass their tests.
- Type checking, linting, tests, development build, and production build pass.
