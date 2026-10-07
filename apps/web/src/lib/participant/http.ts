/**
 * The HTTP the shell needs before the device runtime exists: bootstrap and the QR exchange. It imports nothing
 * from `@ueberblick/client` (that package, with core geo, is a lazy chunk). `fetch` is a port so it runs under test.
 */
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { LocalizedString } from '@ueberblick/core';
import { BOOTSTRAP_CACHE_FORMAT, cachedIdentityOf, decodeBootstrap, decodeCachedIdentity } from './decode';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `GET /participant-api/bootstrap`: who, which project, the session, the participant's own login and the deployed
 * config in its compiled form. The identity part is what the header and the profile card show; it is cached on the
 * device (below), so an offline cold start shows the same.
 */
export interface BootstrapIdentity {
  readonly project: {
    readonly key: string;
    readonly displayName: string;
    /** Blob sha of the project icon, or null when the project has none. */
    readonly icon: string | null;
    /** The session is a preview login (project `<key>__vorschau`); the server decides, the device never parses the key (WP-373). */
    readonly preview: boolean;
  };
  readonly participant: {
    readonly id: string;
    readonly name: string;
    readonly roles: readonly string[];
    /** The roster e-mail and phone (WP-310 `FIXED_ATTRS`); null when the roster has none (a guest has none). */
    readonly email: string | null;
    readonly phone: string | null;
  };
  readonly version: number;
  readonly session: { readonly expiresAt: string };
  /** The participant's own token and login link (info-page variables); null when no active token exists. */
  readonly login: { readonly token: string; readonly link: string } | null;
  /** The project's info pages in sort order, every locale (the device picks one), content as authored HTML. */
  readonly infoPages: readonly InfoPageData[];
  /** The instance's legal pages in the operator's order (WP-638); the body is HTML, sanitised on display. */
  readonly legalPages: readonly LegalPageData[];
}

export interface InfoPageData {
  readonly key: string;
  readonly title: LocalizedString;
  readonly content: LocalizedString;
}
export interface LegalPageData {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
}

export interface Bootstrap extends BootstrapIdentity {
  readonly compiled: CompiledConfigData;
  /** The pull header's `access` value of this participant (WP-798); the sync baseline. Never cached: an offline start has none. */
  readonly access?: string;
}

/** What the device opens with: the server's bootstrap, or the cached identity offline (the config is then in the store). */
export type DeviceStart = BootstrapIdentity & {
  readonly compiled?: CompiledConfigData;
  readonly access?: string;
};

export type BootstrapResult =
  | { readonly kind: 'ok'; readonly bootstrap: DeviceStart; readonly offline: boolean }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly status: number | undefined };

/** Where the identity is kept between starts (localStorage in the browser). */
export interface BootstrapCache {
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

const CACHE_KEY = 'ub:bootstrap';

/** The browser's cache, or undefined where there is no usable `localStorage`. */
export function localBootstrapCache(): BootstrapCache | undefined {
  try {
    const storage = globalThis.localStorage as Storage | undefined;
    if (storage === undefined) return undefined;
    return {
      read: () => storage.getItem(CACHE_KEY),
      write: (text) => storage.setItem(CACHE_KEY, text),
      clear: () => storage.removeItem(CACHE_KEY),
    };
  } catch {
    return undefined;
  }
}

export const json = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
};

/** Offline (no answer at all) the cached identity opens the app until its session expires; a refusal or a bad answer never does. */
export async function loadBootstrap(
  fetch: FetchLike,
  cache: BootstrapCache | undefined = localBootstrapCache(),
  now: () => number = Date.now,
): Promise<BootstrapResult> {
  let res: Response;
  try {
    res = await fetch('/participant-api/bootstrap');
  } catch {
    const text = cache?.read() ?? null;
    const identity = text === null ? undefined : decodeCachedIdentity(text);
    if (identity === undefined) return { kind: 'failed', status: undefined };
    // The session may have ended while the phone was away from the network: an expired identity opens nothing (WP-769).
    if (now() >= Date.parse(identity.session.expiresAt)) {
      cache?.clear();
      return { kind: 'signed_out' };
    }
    return { kind: 'ok', bootstrap: identity, offline: true };
  }
  if (res.status === 401) {
    cache?.clear(); // signed out: the next person on this phone does not see the last one's token
    return { kind: 'signed_out' };
  }
  if (!res.ok) return { kind: 'failed', status: res.status };
  const decoded = decodeBootstrap(await json(res));
  if (!decoded.ok) return { kind: 'invalid', reason: decoded.reason };
  try {
    cache?.write(
      JSON.stringify({ format: BOOTSTRAP_CACHE_FORMAT, identity: cachedIdentityOf(decoded.bootstrap) }),
    );
  } catch {
    // a full or blocked storage costs only the offline header, never the start
  }
  return { kind: 'ok', bootstrap: decoded.bootstrap, offline: false };
}
