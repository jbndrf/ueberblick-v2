/**
 * The pack hashes that version pinning keeps alive (A-029, WP-315): a feature with `pinned_version` is still planned
 * under that version's config, so the packs of that version stay on the server for as long as one feature pins it.
 * Versions are immutable rows, so a version's file is read once per database.
 */
import type { TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { loadData } from '../deploy/versions';
import { packTargets } from './store';

const files = new WeakMap<Db, Map<number, TemplateFile | undefined>>();

/** The effective files of every version at least one feature pins. One query over the partial index. */
export function pinnedFiles(db: Db): TemplateFile[] {
  let held = files.get(db);
  if (held === undefined) files.set(db, (held = new Map()));
  const versions = db
    .prepare<{ pinned_version: number }>(
      'SELECT DISTINCT pinned_version FROM features WHERE pinned_version IS NOT NULL',
    )
    .all();
  const out: TemplateFile[] = [];
  for (const { pinned_version: v } of versions) {
    if (!held.has(v)) held.set(v, loadData(db, v)?.file);
    const file = held.get(v);
    if (file !== undefined) out.push(file);
  }
  return out;
}

/** The pack hashes of the pinned versions: `PackBuilderDeps.pinned`. */
export function pinnedPackHashes(db: Db): Set<string> {
  return new Set(pinnedFiles(db).flatMap((f) => packTargets(f).map((t) => t.hash)));
}
