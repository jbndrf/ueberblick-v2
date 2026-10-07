// The Speicher section of the Offline tab (v3 `SettingsSheet.svelte:817-870`): how full the device is, what it holds,
// and whether the browser promised to keep it. Pure: the caller reads the browser and the stores.
import type { PackCounts } from '@ueberblick/client';

/** v3's colour steps of the bar: orange above 70 %, red above 90 %. */
export const WARN_PERCENT = 70;
export const HIGH_PERCENT = 90;

export const FILL_LEVELS = ['ok', 'warn', 'high'] as const;
export type FillLevel = (typeof FILL_LEVELS)[number];

export interface StorageStats {
  readonly usage: number;
  /** 0 when the browser does not tell; the bar is hidden then. */
  readonly quota: number;
  readonly percent: number;
  readonly level: FillLevel;
  readonly persistent: boolean;
  readonly tiles: number;
  readonly records: number;
  /** Files (photos) on the device; undefined until the device store can count them. */
  readonly files: number | undefined;
}

export interface StatsInput {
  readonly estimate: { readonly usage: number; readonly quota: number } | undefined;
  readonly persisted: boolean;
  readonly counts: PackCounts;
  readonly records: number;
  readonly files?: number;
}

export function storageStats(i: StatsInput): StorageStats {
  const usage = i.estimate?.usage ?? 0;
  const quota = i.estimate?.quota ?? 0;
  const percent = quota > 0 ? Math.min(100, Math.max(0, (usage / quota) * 100)) : 0;
  return {
    usage,
    quota,
    percent,
    level: percent > HIGH_PERCENT ? 'high' : percent > WARN_PERCENT ? 'warn' : 'ok',
    persistent: i.persisted,
    tiles: i.counts.totals.tiles,
    records: i.records,
    files: i.files,
  };
}
