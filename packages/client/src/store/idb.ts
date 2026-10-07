/** Promise helpers over the structural IndexedDB types. Explicit transactions, typed errors. */
import { DeviceStoreError } from './codes';
import type { IdbDatabase, IdbRequest, IdbTransaction } from './idb-types';

export function isQuota(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'QuotaExceededError';
}

export function toStoreError(e: unknown): DeviceStoreError {
  if (e instanceof DeviceStoreError) return e;
  const message =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null
        ? String((e as { message?: unknown }).message)
        : String(e);
  return isQuota(e)
    ? new DeviceStoreError('quota_exceeded', 'Storage quota exceeded; nothing was written.', { cause: e })
    : new DeviceStoreError('aborted', `Transaction aborted: ${message}`, { cause: e });
}

export function requestResult<T>(req: IdbRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(toStoreError(req.error));
  });
}

/**
 * Runs `work` inside one transaction and resolves when it committed. Any throw in `work` or in a
 * callback wrapped with `guard` aborts the whole transaction: nothing is partially written.
 */
export function runTx(
  db: IdbDatabase,
  stores: readonly string[],
  mode: 'readonly' | 'readwrite',
  work: (
    tx: IdbTransaction,
    guard: <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => void,
  ) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(toStoreError(e));
    };
    let tx: IdbTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      fail(e);
      return;
    }
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onabort = () => fail(tx.error ?? new Error('aborted'));
    tx.onerror = () => undefined; // the abort handler reports
    const abort = (e: unknown) => {
      fail(e);
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
    };
    const guard =
      <A extends unknown[]>(fn: (...a: A) => void) =>
      (...a: A) => {
        try {
          fn(...a);
        } catch (e) {
          abort(e);
        }
      };
    try {
      work(tx, guard);
    } catch (e) {
      abort(e);
    }
  });
}
