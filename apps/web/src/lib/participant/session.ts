/**
 * Starting and ending the participant's session, apart from the route (WP-656): bootstrap, then the device through
 * `switchDevice` (takeover: another person or project closes the open device and opens its own, as v3 kept one
 * database per participant), and sign-out. The device runtime is a lazy chunk, so the route passes `load`.
 */
import type { Device, DevicePorts } from './device';
import type { switchDevice } from './device-switch';
import type { BootstrapCache, BootstrapResult, FetchLike } from './http';
import { startupNotice, type StartupNotice } from './insecure';
import type { Locale } from './messages';

/** The lazy chunk: the device-switch module's `switchDevice` and the browser's ports. */
export interface SessionLoad {
  readonly switchDevice: typeof switchDevice;
  readonly ports: () => DevicePorts;
}

export type SessionStart =
  | { readonly kind: 'ready'; readonly device: Device }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'failed'; readonly invalid?: string }
  | { readonly kind: 'notice'; readonly notice: StartupNotice };

export interface SessionDeps {
  readonly bootstrap: () => Promise<BootstrapResult>;
  readonly load: () => Promise<SessionLoad>;
  /** The open device, if any: the same person keeps it, another one replaces it. */
  readonly current?: Device;
  readonly locale: Locale;
}

export async function startSession(deps: SessionDeps): Promise<SessionStart> {
  const boot = await deps.bootstrap();
  if (boot.kind === 'signed_out') return { kind: 'signed_out' };
  if (boot.kind === 'invalid') return { kind: 'failed', invalid: boot.reason };
  // No answer and no cached identity: nobody is signed in on this device (a sign-out clears it). v3 sent that start to
  // /login too (`(participant)/+layout.svelte` onMount); the sign-in page says it needs the network once (WP-866).
  if (boot.kind === 'failed' && boot.status === undefined) return { kind: 'signed_out' };
  if (boot.kind === 'failed') return { kind: 'failed' };
  try {
    const loaded = await deps.load();
    const device = await loaded.switchDevice(deps.current, boot.bootstrap, loaded.ports(), deps.locale);
    return { kind: 'ready', device };
  } catch (e) {
    return { kind: 'notice', notice: startupNotice(e) };
  }
}

/** Ends the session on the server, wipes the person's local copy and forgets the cached identity, so the next person on this phone never sees it. */
export async function signOutSession(
  fetch: FetchLike,
  cache: BootstrapCache | undefined,
  wipe: () => Promise<void> = async () => undefined,
): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }); // no answer: the session stands, and so do the cache and the local copy
  try {
    await wipe(); // the person's local copy goes with the session (v3 resetAllParticipantState), wherever it stands
  } catch (e) {
    console.error('participant wipe:', e);
  } finally {
    cache?.clear();
  }
}
