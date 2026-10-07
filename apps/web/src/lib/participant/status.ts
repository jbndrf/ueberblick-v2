/**
 * The honest state (docs/13 principle 8) from what the queue and the sync worker say. Pure: no I/O, no clock.
 * A hold that needs a person (an incompatible server, an expired sign-in, a stopped sync) becomes a `SyncNotice` the
 * shell shows above the header. The connection and sync card itself is v3's (`SettingsSheet.svelte:401-514`, ported as
 * the Profil tab); there is no separate status line (WP-656 removed the unwired `toStatusModel`, v3 had none).
 */
import type { QueueStatus, SyncStatus } from '@ueberblick/client';
import { message, type Locale } from './messages';

export interface NoticeInputs {
  readonly sync: SyncStatus;
  readonly queue: QueueStatus;
  readonly locale: Locale;
}

export interface SyncNotice {
  readonly kind: 'incompatible_protocol' | 'auth_expired' | 'sync_stopped';
  readonly text: string;
  /** Offer signing in again. */
  readonly signIn: boolean;
}

/** What needs a person's attention beyond the Profil card; undefined while nothing does. */
export function syncNotice(i: NoticeInputs): SyncNotice | undefined {
  const { queue, sync, locale } = i;
  if (queue.hold === 'incompatible_protocol')
    return {
      kind: 'incompatible_protocol',
      signIn: false,
      text: message(locale, 'notice_incompatible', {
        v: queue.serverProtocol ?? '?',
        count: queue.pending,
      }),
    };
  if (queue.hold === 'auth_expired')
    return {
      kind: 'auth_expired',
      signIn: true,
      text: message(locale, 'notice_auth_expired', { count: queue.pending }),
    };
  const failure = sync.lastError;
  if (failure !== undefined && failure.kind !== 'transport')
    return {
      kind: 'sync_stopped',
      signIn: false,
      text: message(locale, 'notice_sync_stopped', { message: failure.message }),
    };
  return undefined;
}

/** Past this many days without a sync the Profil card warns (v3 `STALE_THRESHOLD_DAYS`, freshness.ts:11). */
export const STALE_THRESHOLD_DAYS = 7;
const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Freshness {
  /** "vor 5 Minuten"; undefined while this device never synced. */
  readonly ago: string | undefined;
  /** Whole days since the last sync once it is at least `STALE_THRESHOLD_DAYS` ago; else undefined. */
  readonly staleDays: number | undefined;
}

/** How old the data on the device is (v3 `formatAgo` and `daysSinceSync`); pure, `nowMs` comes from the device clock. */
export function freshness(lastSyncedAt: string | null, nowMs: number, locale: Locale): Freshness {
  const then = lastSyncedAt === null ? Number.NaN : Date.parse(lastSyncedAt);
  if (Number.isNaN(then)) return { ago: undefined, staleDays: undefined };
  const diff = Math.max(0, nowMs - then);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const mins = Math.round(diff / MINUTE);
  const hours = Math.round(mins / 60);
  const ago =
    mins < 60
      ? rtf.format(-mins, 'minute')
      : hours < 24
        ? rtf.format(-hours, 'hour')
        : rtf.format(-Math.round(hours / 24), 'day');
  const days = Math.floor(diff / DAY);
  return { ago, staleDays: days >= STALE_THRESHOLD_DAYS ? days : undefined };
}
