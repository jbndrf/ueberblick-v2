/** The admin view of the packs of a config: definition, estimate, build state and progress per pack and layer. */
import {
  estimatePack,
  packTileType,
  sourceMaxZoom,
  type LocalizedString,
  type PackBuildState,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { layerEstimate, packTargets, rowsOf, type BuildRow, type PackTarget } from '../../packs';

export interface LayerStatus {
  readonly layer: string;
  readonly state: PackBuildState;
  readonly progress: { readonly tiles_done: number; readonly tiles_total: number; readonly bytes: number };
  /** Of the finished file; null until `ready`. */
  readonly max_zoom: number | null;
  readonly tiles: number | null;
  readonly sha256: string | null;
  readonly error: string | null;
  readonly estimate: { readonly tiles: number; readonly bytes: number; readonly max_zoom: number };
}

export interface PackStatus {
  readonly key: string;
  readonly label: LocalizedString;
  readonly bounds: readonly [number, number, number, number];
  readonly min_zoom: number;
  readonly max_zoom: number;
  readonly roles: readonly string[] | null;
  readonly hash: string;
  readonly estimate: { readonly tiles: number; readonly bytes: number };
  readonly state: PackBuildState;
  readonly progress: { readonly tiles_done: number; readonly tiles_total: number; readonly bytes: number };
  /** Size of the finished files; while building, what is written so far. */
  readonly bytes: number;
  /** When the last layer finished; null until every layer is `ready`. */
  readonly built_at: string | null;
  readonly error: string | null;
  readonly layers: readonly LayerStatus[];
}

function packState(layers: readonly LayerStatus[]): PackBuildState {
  if (layers.some((l) => l.state === 'failed')) return 'failed';
  if (layers.some((l) => l.state === 'building')) return 'building';
  if (layers.length > 0 && layers.every((l) => l.state === 'ready')) return 'ready';
  return 'queued';
}

function layerStatus(t: PackTarget, l: PackTarget['layers'][number], row: BuildRow | undefined): LayerStatus {
  const est = layerEstimate(t.def, l.def);
  return {
    layer: l.layer,
    state: row?.state ?? 'queued',
    progress: {
      tiles_done: row?.tiles_done ?? 0,
      tiles_total: row === undefined || row.tiles_total === 0 ? est.tiles : row.tiles_total,
      bytes: row?.bytes ?? 0,
    },
    max_zoom: row?.state === 'ready' ? row.max_zoom : null,
    tiles: row?.state === 'ready' ? row.tiles : null,
    sha256: row?.state === 'ready' ? row.sha256 : null,
    error: row?.state === 'failed' ? row.error : null,
    estimate: { tiles: est.tiles, bytes: est.bytes, max_zoom: est.maxZoom },
  };
}

export function packStatuses(db: Db, file: TemplateFile): PackStatus[] {
  return packTargets(file).map((t) => {
    const rows = new Map(rowsOf(db, [t.hash]).map((r) => [r.layer, r]));
    const layers = t.layers.map((l) => layerStatus(t, l, rows.get(l.layer)));
    const state = packState(layers);
    const est = estimatePack(
      t.def.bounds,
      t.def.min_zoom,
      t.def.max_zoom,
      t.layers.map((l) => ({
        key: l.layer,
        tileType: packTileType(l.def),
        sourceMaxZoom: sourceMaxZoom(l.def),
      })),
    );
    const sum = (pick: (l: LayerStatus) => number): number => layers.reduce((a, l) => a + pick(l), 0);
    const stamps = t.layers.map((l) => rows.get(l.layer)?.updated_at ?? '').sort();
    return {
      key: t.key,
      label: t.def.label,
      bounds: t.def.bounds,
      min_zoom: t.def.min_zoom,
      max_zoom: t.def.max_zoom,
      roles: t.def.roles ?? null,
      hash: t.hash,
      estimate: { tiles: est.tiles, bytes: est.bytes },
      state,
      progress: {
        tiles_done: sum((l) => l.progress.tiles_done),
        tiles_total: sum((l) => l.progress.tiles_total),
        bytes: sum((l) => l.progress.bytes),
      },
      bytes: sum((l) => l.progress.bytes),
      built_at: state === 'ready' ? (stamps[stamps.length - 1] ?? null) : null,
      error: layers.find((l) => l.error !== null)?.error ?? null,
      layers,
    };
  });
}
