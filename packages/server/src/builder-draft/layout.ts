import type { Db } from '../db/driver';

/** One node position on the canvas of a feature type. */
export interface LayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** More nodes than any real process has (stages, rules, entries); a larger body is refused. */
export const MAX_LAYOUT_NODES = 500;

/** The port for stored canvas positions (`canvas_layout`, migration 23); they are not part of any config. */
export interface LayoutStore {
  get(type: string): readonly LayoutNode[];
  /** Makes `nodes` the stored set of `type`: upserts them and prunes the rest, in one transaction. */
  replace(type: string, nodes: readonly LayoutNode[], by: string, at: string): void;
}

export function createLayoutStore(db: Db): LayoutStore {
  return {
    get: (type) =>
      db
        .prepare<LayoutNode>('SELECT node_id AS id, x, y FROM canvas_layout WHERE type = ? ORDER BY node_id')
        .all(type),
    replace(type, nodes, by, at) {
      db.transaction(() => {
        db.prepare('DELETE FROM canvas_layout WHERE type = ?').run(type);
        const ins = db.prepare(
          'INSERT INTO canvas_layout (type, node_id, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const n of nodes) ins.run(type, n.id, n.x, n.y, by, at);
      });
    },
  };
}
