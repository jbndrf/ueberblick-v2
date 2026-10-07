import { unionBbox } from '@ueberblick/core/geo/bbox';
import { edgeKey, isServed, type Bbox, type FoldedFeature, type Json } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { FoldBatch, FoldWriter } from '../contract';

/** Union of the 2D bboxes of all geometry properties that have a value, or undefined. */
export function featureBbox(f: FoldedFeature): Bbox | undefined {
  return unionBbox(Object.values(f.derived).map((d) => d.bbox));
}

/** Persists fold output in one transaction per `apply` (see contract.ts). Statements are prepared once, here. */
export function createFoldWriter(db: Db): FoldWriter {
  const stale = db.prepare<{ updated_seq: number }>('SELECT updated_seq FROM features WHERE id = ?');
  const upsert = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, area_m2, updated_seq, lifecycle,
       created_by, created_at, changed_at, pinned_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET type = excluded.type, config_version = excluded.config_version,
       properties = excluded.properties, geometry = excluded.geometry, anchor_lon = excluded.anchor_lon,
       anchor_lat = excluded.anchor_lat, area_m2 = excluded.area_m2, updated_seq = excluded.updated_seq,
       lifecycle = excluded.lifecycle, created_by = excluded.created_by, created_at = excluded.created_at,
       changed_at = excluded.changed_at, pinned_version = excluded.pinned_version`,
  );
  const rowid = db.prepare<{ rowid: number }>('SELECT rowid FROM features WHERE id = ?');
  const unindex = db.prepare('DELETE FROM feature_bbox WHERE rid = ?');
  const index = db.prepare('INSERT INTO feature_bbox (rid, minx, maxx, miny, maxy) VALUES (?, ?, ?, ?, ?)');
  const removeEdge = db.prepare('DELETE FROM edges WHERE from_id = ? AND relation = ? AND to_id = ?');
  const tombstone = db.prepare("INSERT INTO tombstones (seq, kind, id) VALUES (?, 'edge', ?)");
  const head = db.prepare<{ seq: number }>(
    `SELECT max(coalesce((SELECT max(seq) FROM observations), 0), coalesce((SELECT max(seq) FROM tombstones), 0)) AS seq`,
  );
  const putEdge = db.prepare(
    `INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (from_id, relation, to_id) DO UPDATE SET derived = excluded.derived, updated_seq = excluded.updated_seq`,
  );

  const apply = (batch: FoldBatch): void =>
    db.transaction(() => {
      for (const f of batch.features) {
        const cur = stale.get(f.id);
        if (cur !== undefined && cur.updated_seq >= f.updatedSeq) continue;
        const key = batch.schema.types.get(f.type)?.primaryGeometry;
        const d = key === undefined ? undefined : f.derived[key];
        const g = key === undefined ? undefined : (f.properties[key] as Json | undefined);
        upsert.run(
          f.id,
          f.type,
          batch.configVersion,
          JSON.stringify(f.properties),
          g === undefined ? null : JSON.stringify(g),
          d?.pointOnSurface.coordinates[0] ?? null,
          d?.pointOnSurface.coordinates[1] ?? null,
          d?.areaM2 ?? null,
          f.updatedSeq,
          f.lifecycle,
          f.createdBy ?? null,
          f.createdAt ?? null,
          f.changedAt ?? null,
          f.pinnedVersion ?? null,
        );
        const id = (rowid.get(f.id) as { rowid: number }).rowid;
        unindex.run(id);
        const box = isServed(f.lifecycle) ? featureBbox(f) : undefined;
        if (box) index.run(id, box[0], box[2], box[1], box[3]);
      }
      // A removed edge leaves an `edge` tombstone (id = edgeKey) at a fresh seq above everything stored and above
      // `batch.seq`, so a device that synced before the removal learns of it (docs/07). One seq per tombstone (PK).
      const putKeys = new Set(batch.edges.put.map(edgeKey));
      let next: number | undefined;
      for (const e of batch.edges.remove) {
        if (removeEdge.run(e.from, e.relation, e.to).changes === 0 || putKeys.has(edgeKey(e))) continue;
        next ??= Math.max((head.get() as { seq: number }).seq, batch.seq) + 1;
        tombstone.run(next++, edgeKey(e));
      }
      for (const e of batch.edges.put) putEdge.run(e.from, e.relation, e.to, e.derived ? 1 : 0, batch.seq);
    });
  return { apply };
}
