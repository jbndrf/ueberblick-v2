import type { Actor, Seq, SyncEdge, SyncPage, SyncRequest, SyncTombstone } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { createEverVisible } from './ever-visible';
import { SYNC_PAGE_ROWS, SyncUnavailable, type SyncService, type SyncServiceDeps } from './contract';
import {
  edgesInWindow,
  edgesOfFrom,
  edgesOfTo,
  readEdges,
  readObservations,
  readTombstones,
  toSyncFeature,
  type FeatureRow,
  SYNC_FEATURE_COLUMNS,
} from './read';
import { withChoosable } from './choosable';
import { runsOfPage } from './runs';
import { createLiveScopes, type LiveScope } from './live';
import { createConfigResolver } from '../store/run/config-for';
import { servedSql } from '@ueberblick/core';
import { accessOf } from './access';

const HEAD_SQL = `SELECT max(coalesce((SELECT max(seq) FROM observations), 0),
                            coalesce((SELECT max(seq) FROM tombstones), 0)) AS seq`;

export function createSyncService(db: Db, deps: SyncServiceDeps): SyncService {
  const versions = createConfigResolver(db, deps.versions);
  const liveScopes = createLiveScopes(db, versions);
  const headStmt = db.prepare<{ seq: number }>(HEAD_SQL);
  const head = (): Seq => headStmt.get()?.seq ?? 0;
  const everVisible = createEverVisible(db, deps);

  const empty = (
    scope: LiveScope,
    kind: SyncPage['header']['kind'],
    cursor: Seq,
    headSeq: Seq,
  ): SyncPage => ({
    header: {
      kind,
      cursor,
      head: headSeq,
      more: false,
      scopeFingerprint: scope.fingerprint,
      access: accessOf(scope.actor),
      versions: versionsOf(scope),
    },
    features: [],
    edges: [],
    observations: [],
    tombstones: [],
    runs: [],
    people: [],
  });

  function snapshot(scope: LiveScope, req: SyncRequest, now: string, limit: number): SyncPage {
    const current = head();
    const pin = req.pin === undefined ? current : Math.min(req.pin, current);
    const vis = scope.visibleSql('sf', now);
    const rows = db
      .prepare<FeatureRow>(
        `SELECT ${SYNC_FEATURE_COLUMNS} FROM features sf
         WHERE sf.updated_seq > ? AND sf.updated_seq <= ? AND ${servedSql('sf.lifecycle')} AND ${vis.sql}
         ORDER BY sf.updated_seq LIMIT ?`,
      )
      .all(req.after ?? 0, pin, ...(vis.params as (string | number)[]), limit + 1);
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const observations = readObservations(db, scope, page, pin);
    return {
      header: {
        kind: 'snapshot',
        cursor: last === undefined ? (req.after ?? 0) : last.updated_seq,
        head: pin,
        more,
        scopeFingerprint: scope.fingerprint,
        access: accessOf(scope.actor),
        versions: versionsOf(scope),
      },
      features: page.map((r) => toSyncFeature(scope, r)),
      edges: dedupe(
        readEdges(
          db,
          scope,
          now,
          edgesOfFrom(
            page.map((r) => r.id),
            pin,
          ),
        ),
      ),
      observations,
      tombstones: [],
      ...runsOfPage(db, scope, observations),
    };
  }

  function delta(scope: LiveScope, req: SyncRequest, now: string, limit: number): SyncPage {
    const current = head();
    if (req.since >= current) return empty(scope, 'delta', req.since, current);
    const vis = scope.visibleSql('sf', now);
    const rows = db
      .prepare<FeatureRow>(
        `SELECT ${SYNC_FEATURE_COLUMNS},
                CASE WHEN ${servedSql('sf.lifecycle')} AND ${vis.sql} THEN 1 ELSE 0 END AS vis
         FROM features sf WHERE sf.updated_seq > ? ORDER BY sf.updated_seq LIMIT ?`,
      )
      .all(...(vis.params as (string | number)[]), req.since, limit + 1);
    const more = rows.length > limit;
    const window = more ? rows.slice(0, limit) : rows;
    const upper = more ? (window[window.length - 1] as FeatureRow).updated_seq : current;

    const shown = window.filter((r) => r.vis === 1);
    const tombstones: SyncTombstone[] = [];
    for (const r of window)
      if (r.vis !== 1 && everVisible(scope.at(scope.versionOf(r.pinned_version)), r, now))
        tombstones.push({ seq: r.updated_seq, kind: 'feature', id: r.id });
    const list = shown.map((r) => r.id);
    const edges = dedupe([
      ...readEdges(db, scope, now, edgesInWindow(req.since, upper)),
      ...readEdges(db, scope, now, edgesOfFrom(list, current)),
      ...readEdges(db, scope, now, edgesOfTo(list, current)),
    ]);
    tombstones.push(...readTombstones(db, scope, now, req.since, upper));
    tombstones.sort((a, b) => a.seq - b.seq);
    const observations = readObservations(db, scope, shown, current);
    return {
      header: {
        kind: 'delta',
        cursor: upper,
        head: current,
        more,
        scopeFingerprint: scope.fingerprint,
        access: accessOf(scope.actor),
        versions: versionsOf(scope),
      },
      features: shown.map((r) => toSyncFeature(scope, r)),
      edges,
      observations,
      tombstones,
      ...runsOfPage(db, scope, observations),
    };
  }

  return {
    head,
    versions,
    visible(actor, alias) {
      const deployed = deps.config();
      if (!deployed) throw new SyncUnavailable();
      return liveScopes(actor, deployed.version).visibleSql(alias, deps.clock.now());
    },
    page(actor: Actor, req: SyncRequest): SyncPage {
      const deployed = deps.config();
      if (!deployed) throw new SyncUnavailable();
      const scope = liveScopes(actor, deployed.version);
      const now = deps.clock.now();
      const limit = Math.min(req.limit ?? SYNC_PAGE_ROWS, SYNC_PAGE_ROWS);
      const kind = req.since === 0 ? 'snapshot' : 'delta';
      if (req.scope !== '' && req.scope !== scope.fingerprint)
        return empty(scope, kind, kind === 'snapshot' ? (req.after ?? 0) : req.since, head());
      // One read transaction per page: the page is one consistent view even while runs commit.
      return db.transaction(() =>
        withChoosable(
          db,
          scope,
          req,
          kind === 'snapshot' ? snapshot(scope, req, now, limit) : delta(scope, req, now, limit),
        ),
      );
    },
  };
}

const versionsOf = (scope: LiveScope): SyncPage['header']['versions'] => ({
  deployed: scope.deployed,
  live: scope.live,
});

function dedupe(edges: readonly SyncEdge[]): SyncEdge[] {
  const seen = new Set<string>();
  const out: SyncEdge[] = [];
  for (const e of edges) {
    const k = `${e.from}\u0000${e.relation}\u0000${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
