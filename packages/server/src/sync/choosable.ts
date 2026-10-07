/**
 * The choosable participants on a page (WP-725, `select.all`): the list is shipped only when it differs from the set
 * the device says it holds (`SyncRequest.choosable`, the `choosableHash`), on any page type, and then it REPLACES the
 * device's set. The scope fingerprint does not cover it, so a participant joining or leaving causes no re-snapshot.
 * Cost: one scan of `participants` (hundreds of rows) per pull, only for callers in some `select.all`.
 */
import { choosableHash, type SyncPage, type SyncPerson, type SyncRequest } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { seesChoosable } from './runs';
import type { LiveScope } from './live';

function currentSet(db: Db, scope: LiveScope): { id: string; name: string }[] {
  if (!seesChoosable(scope)) return [];
  return db
    .prepare<{ id: string; name: string }>(
      `SELECT id, coalesce(name, '') AS name FROM participants WHERE disabled_at IS NULL ORDER BY id`,
    )
    .all();
}

/** The page with the choosable list added, or unchanged when the device already holds the current set. */
export function withChoosable(
  db: Db,
  scope: LiveScope,
  req: Pick<SyncRequest, 'choosable'>,
  page: SyncPage,
): SyncPage {
  const set = currentSet(db, scope);
  const hash = choosableHash(set);
  if (hash === (req.choosable ?? '')) return page;
  const chosen = new Map(set.map((p) => [p.id, p.name] as const));
  const people: SyncPerson[] = page.people
    .filter((p) => !chosen.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));
  for (const [id, name] of chosen) people.push({ id, name, choosable: true });
  return { ...page, header: { ...page.header, choosable: hash }, people };
}
