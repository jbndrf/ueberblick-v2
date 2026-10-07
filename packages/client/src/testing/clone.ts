/**
 * The one copy every in-memory device fake makes of what it stores. IndexedDB structured-clones a value on `add` and
 * `put`; a fake that keeps the object as is hides a Proxy, function or DOM node in a run input until a phone throws
 * `DataCloneError` (the WP-696 blocker). Fakes call this on the way in, so vitest fails the same way. The in-memory
 * backends exported for tests (`memoryBackend`) import this file, never a `*.testing.ts` one.
 */
export function deviceClone<T>(value: T): T {
  return structuredClone(value);
}
