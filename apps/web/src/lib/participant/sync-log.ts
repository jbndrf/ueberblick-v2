/**
 * Console noise while the device is offline (WP-731). Being offline is expected, and the app already shows it in its
 * status, so a failed `fetch` (it rejects with a `TypeError`) is logged once per offline period, not once per attempt.
 * The period ends when the browser says it is `online` again. Every other error is logged each time.
 */
export interface QuietLog {
  /** The `onError` of the device ports. */
  report(where: string, error: unknown): void;
  /** The browser is online again: the next network failure is a new period and is logged. */
  backOnline(): void;
}

/** A `fetch` that found no server or no network rejects with a `TypeError` (Chrome, Firefox and Safari alike). */
export const isNetworkFailure = (error: unknown): boolean => error instanceof TypeError;

export function quietOfflineLog(write: (where: string, error: unknown) => void): QuietLog {
  let said = false;
  return {
    report(where, error) {
      if (isNetworkFailure(error)) {
        if (said) return;
        said = true;
      }
      write(where, error);
    },
    backOnline() {
      said = false;
    },
  };
}
