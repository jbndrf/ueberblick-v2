# Logging privacy rule (WP-537)

Server logs never contain observation values, run input or personal data. They carry **actor ids, opaque ids, codes, counts, durations and truncated IPs** (GDPR research, `docs/research/gdpr-erasure.md` inventory row 12 and P7).

## The rule, enforced three ways
1. **Types.** `packages/server/src/log` holds a typed event registry (`LOG_EVENTS`). `logger.log(event, fields)` accepts exactly the fields declared for that event, each of a declared kind (`LOG_FIELD_KINDS`: `code`, `actor`, `ip`, `id`, `count`, `ms`). There is no kind for a value or run input, so passing one is a type error. The logger also drops undeclared names at runtime. A test asserts that no event declares a forbidden name (`FORBIDDEN_LOG_FIELDS`: value, values, input, name, email, phone, position, body).
2. **IP truncation.** A field of kind `ip` is written as IPv4 `/24` (`203.0.113.0/24`) or IPv6 `/48` (`2001:db8:abcd::/48`). The full address never reaches the sink.
3. **Guardrail (ESLint, part of `npm run lint`).** An override for `packages/server/**` outside `packages/server/src/log/` and outside `*.spec.ts` (specs may spy on `console`) sets `no-restricted-globals` for `console` (catches `console.x`, `console['x']`, aliases and destructuring; ignores comments and strings) and `no-restricted-properties` for `globalThis.console`, `global.console` and `self.console`. It cannot catch dynamic access such as `eval`, `new Function` or computed lookups on a global object (`globalThis[name]`); code review covers those.

To log something new, add an event to `LOG_EVENTS`. A new field kind is a registry change and a privacy review.

## Where the production logger is made
Once per process, in the composition root `apps/web/src/lib/server/runtime.ts` (`createRuntime`): the sink writes one JSON line per event to stdout, the clock is the runtime's clock, and the minimum level comes from `UEBERBLICK_LOG_LEVEL` (`debug`, `info`, `warn` or `error`; default `info`; any other value stops the start with an error). The logger is `runtime().log`; the services that log (`createProjectServices` and `createTimers`, the blob delete failure, the timers loop error) receive that object. Their `log: Logger` dependency is **required**, never optional, so a service cannot silently run without one (R11); tests pass `createLogger` with an array sink. Add no second logger: use `runtime().log` (for example from `hooks.server.ts`).

## Where the declared events are emitted
| Event | Emitted by | Point |
|---|---|---|
| `run.committed`, `run.refused` | `createStore` (`store/run/transaction.ts`, `log.ts`) | in `submitBatch`, after the transaction, once per submitted run; a replay logs nothing; rule-caused runs are not logged separately |
| `run.failed` | `createRunHandlers` (`http/runs/handlers.ts`) | the run intake threw instead of answering: `runId`, `size` (runs in the call: 1 for a single run, the batch size otherwise), `code` (the driver's code, e.g. `SQLITE_BUSY`, else the error name, or `hook_<name>` when a transaction hook such as `hook_timers` threw and the run was rolled back; never the message). `handleError` logs no message, so this line is what names the cause (WP-841) |
| `run.hook_failed` | `createStore` (`store/run/transaction.ts`) | a step after the commit threw (`hook`: `orphans` or `log`; `code` as above). The run stays accepted and the doorbell still rings (WP-842) |
| `sync.served` | `createSyncHandlers` | once per page answered with 200 |
| `http.access` | `handle` in `apps/web/src/hooks.server.ts` (`logHttpAccess`) | once per request after the answer is known, the https redirect, 413 and the signed-out 303 included: `method`, `route` (pattern, `unmatched` if none; never path or query), `status`, truncated `ip`, `ms`. No user agent, no byte count (no field kind for them; a new kind is a privacy review). A throwing sink never fails the answer. Bench: `bench/server-log` |
| `http.error` | `handleError` in `apps/web/src/hooks.server.ts` (`logHttpError`) | server errors (status 500 and above) only, so route probes (404) do not flood the log; route pattern, no message, no URL |
| `auth.failed` | `handle` in `hooks.server.ts` (`logAuthFailure`); `confirm` in `apps/web/src/lib/server/handlers/admin-totp.ts` | a 401 answer of `/api/auth/exchange` or `/api/auth/login` (registered auth error code, `actor: anonymous`); a throttle refusal (429) of those routes (`throttled`); a rejected TOTP confirm (`totp_rejected`) or a throttled one (`throttled`), with the admin id |

Not covered yet: failed logins through OIDC (`oidc/**` has its own error codes and is not logged), a failed session check on an API call (401 from `authorizeProject`: a missing or expired session is not a sign-in attempt), and the password check of other admin routes. The table lists what is emitted, not everything that could fail. An erasure run is an ordinary run (a task with a `redact` step) and is logged like any run (a replay logs nothing). The v3 migration tool (`apps/migrate`) builds its store with a discard logger: a one-off import writes its own report, so its run lines go nowhere. Every event test asserts with `expectDeclaredFieldsOnly` that a line carries nothing outside its declaration.

## Retention
Log lines are kept **30 days** by default. Override with `LOG_RETENTION_DAYS`; `logRetentionDays(env)` reads it. The default applies only when the variable is unset; a value that is not a positive whole number (`-1`, `x`, `0`, `1.5`, empty) throws at startup. Rotation and deletion belong to the deployment (the logger writes to an injected sink, one JSON line per event).

## Not in this logger
Live positions and other telemetry (H5, O14) never go through it: they are personal data with their own store and TTL. Log shipping and metrics are out of scope.

## Overhead
p95 of one `log` call is at most 0.1 ms: `bench/server-log/log.bench.ts`, budget line `server-log-call-p95`.

Logwatch (`docs/process/logwatch.md`) reads these logs through `LOGWATCH_FILES`; because nothing personal is written, its redaction is a second line of defence, not the first.
