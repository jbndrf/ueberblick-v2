/**
 * What a fault of the sync host means to the person (WP-656). The host is the sync pipeline in its worker; its faults
 * reach the app through `onError('host', …)` (`start-sync.ts`). They were a console line only. They now join the
 * device's problem log, so the problem bar says them (docs/13 principle 8), and the Profil sync card shows the same
 * text where v3 shows a failed sync (`SettingsSheet.svelte:456-457`, `syncError`).
 */
import { HostProtocolError } from '@ueberblick/client';
import type { Locale } from './messages';
import { problemText, type AppProblem } from './notices';

/** A page that outlived an update speaks another host protocol than the new worker: these codes say so. */
const STALE_CODES: readonly string[] = ['bad_version', 'unknown_kind', 'ill_typed'];

/** The problem a host fault is, or undefined when the host mends it by itself (a diverged replica is re-read). */
export function hostFaultProblem(error: unknown): AppProblem | undefined {
  if (error instanceof HostProtocolError) {
    if (error.code === 'replica_diverged') return undefined;
    if (STALE_CODES.includes(error.code))
      return { code: 'stale_bundle', subject: 'host', detail: error.code };
  }
  return {
    code: 'sync_host_fault',
    subject: 'host',
    detail: error instanceof Error ? error.message : String(error),
  };
}

/** The text of a host fault among the device's problems, for the Profil sync card; undefined while there is none. */
export function hostFaultText(problems: readonly AppProblem[], locale: Locale): string | undefined {
  const fault = problems.find((p) => p.code === 'stale_bundle' || p.code === 'sync_host_fault');
  return fault === undefined ? undefined : problemText(locale, fault);
}
