/**
 * What the Offline-Pakete table shows in its Status, Kacheln and Größe columns (v3 `status`, `tile_count`,
 * `file_size_bytes`). A pack in the draft has no build until it is published; a published pack shows the build state the
 * existing endpoint reports (A-032, `PackStatus`). A pack whose definition changed after the build counts as unpublished
 * too, because the next publish builds it anew.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core';
import type { PackStatus } from '@ueberblick/server';
import type { PackRow } from './packs';

export const POLL_MS = 3000;

/** v3's draft, processing, ready, failed; plus the queue the engine has before the worker takes a pack. */
export const PACK_SHOWN = defineRegistry([
  { key: 'draft', description: 'Not published yet, or changed since it was built: nothing is built.' },
  { key: 'queued', description: 'Waiting for the build worker.' },
  { key: 'building', description: 'The worker is extracting tiles.' },
  { key: 'ready', description: 'The files are complete.' },
  { key: 'failed', description: 'The build gave up; the reason is stored.' },
] as const);
export type PackShown = KeyOf<typeof PACK_SHOWN>;

export interface PackBuild {
  readonly shown: PackShown;
  /** Tiles built so far over the tiles to build, 0 to 100; only while building. */
  readonly percent: number | null;
  /** The finished tile count, or the estimate while it is not built (`approx`). */
  readonly tiles: number;
  readonly approx: boolean;
  readonly bytes: number | undefined;
  readonly error: string | null;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** True when the deployed pack is the draft's definition (same box, zoom, layers, audience). */
export function sameDefinition(row: PackRow, built: PackStatus): boolean {
  return (
    built.bounds.every((n, i) => n === row.bounds[i]) &&
    built.min_zoom === row.minZoom &&
    built.max_zoom === row.maxZoom &&
    sameList(
      built.layers.map((l) => l.layer),
      row.layers,
    ) &&
    sameList(built.roles ?? [], row.roles)
  );
}

export function buildOf(row: PackRow, statuses: readonly PackStatus[] | null): PackBuild {
  const built = statuses?.find((s) => s.key === row.key);
  if (built === undefined || !sameDefinition(row, built))
    return { shown: 'draft', percent: null, tiles: 0, approx: false, bytes: undefined, error: null };
  const ready = built.state === 'ready';
  const done = built.layers.reduce((n, l) => n + (l.tiles ?? 0), 0);
  const total = built.progress.tiles_total;
  return {
    shown: built.state,
    percent:
      built.state === 'building' && total > 0 ? Math.round((100 * built.progress.tiles_done) / total) : null,
    tiles: ready ? done : built.estimate.tiles,
    approx: !ready,
    bytes: ready ? built.bytes : undefined,
    error: built.error,
  };
}

/** The table keeps asking while a published pack is being built. */
export const isBuilding = (statuses: readonly PackStatus[] | null): boolean =>
  statuses?.some((s) => s.state === 'queued' || s.state === 'building') ?? false;
