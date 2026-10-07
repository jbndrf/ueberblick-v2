/** Test helpers for the sync endpoint: a project with row-level `visible_when`, a change helper and a model device. */
import {
  createGeo,
  edgeKey,
  SYNC_PROTOCOL_VERSION,
  type Actor,
  type CompiledConfig,
  type FeatureId,
  type Json,
  type LifecycleState,
  type RecordedObservation,
  type SyncPage,
  type SyncRequest,
  type TemplateFile,
} from '@ueberblick/core';
import { createVersionCache } from '../store/run/config-for';
import { build, fid, golden, headSeq, NOW, rid, setup, type Ctx } from '../store/run/testkit';
import { createSyncService, type SyncService } from './index';
import { isServed } from '@ueberblick/core';

export const VISIBLE_WHEN = "self.zustaendig == actor.id || 'verwaltung' in actor.roles";
/** Visibility through a relation: a checked tree of the species named Linde is visible (and everything to `verwaltung`). */
export const RELATION_VISIBLE_WHEN =
  "(self.stage == 'kontrolliert' && self.art.name_de == 'Linde') || 'verwaltung' in actor.roles";

/** The golden baum type with a row filter: a tree is visible to its assignee and to `verwaltung`. */
export function scopedConfig(
  visibleWhen: string = VISIBLE_WHEN,
  noteRoles: readonly string[] | undefined = undefined,
): CompiledConfig {
  const file = golden('musterstadt-plain').file;
  const baum = file.types?.['baum'];
  if (baum === undefined) throw new Error('golden template has no baum');
  const scoped: TemplateFile = {
    ...file,
    types: {
      ...file.types,
      baum: {
        ...baum,
        permissions: {
          ...baum.permissions,
          visible_when: visibleWhen,
          ...(noteRoles === undefined
            ? {}
            : { see: { ...(baum.permissions?.see as object | undefined), intern_notiz: [...noteRoles] } }),
        },
      },
    },
  };
  return build(scoped);
}

export interface SyncCtx extends Ctx {
  readonly service: SyncService;
  /** Appends observations for one feature after the current head, folded like an import. Returns the new head. */
  change(id: FeatureId, values: Readonly<Record<string, Json>>): number;
  /** Pins a stored feature to a config version (what WP-317's deploy writes). */
  pin(id: FeatureId, version: number | null): void;
}

/** Several stored versions (A-029): `config` is version 1, `configs` the others; `deployed` names the deployed one. */
export interface SyncVersionsSetup {
  readonly configs: ReadonlyMap<number, CompiledConfig>;
  readonly deployed: number;
}

export function syncSetup(
  config: CompiledConfig = scopedConfig(),
  clock = { now: () => NOW },
  versions?: SyncVersionsSetup,
): SyncCtx {
  const ctx = setup({ config, clock, ...(versions ?? {}) });
  const at = (v: number): CompiledConfig | undefined => (v === 1 ? config : versions?.configs.get(v));
  const deployed = versions?.deployed ?? 1;
  const service = createSyncService(ctx.db, {
    config: () => ({ version: deployed, config: at(deployed) as CompiledConfig }),
    at,
    versions: createVersionCache(at),
    clock,
    geo: createGeo(),
  });
  return {
    ...ctx,
    service,
    pin(id, version) {
      ctx.db.prepare('UPDATE features SET pinned_version = ? WHERE id = ?').run(version, id);
    },
    change(id, values) {
      let seq = headSeq(ctx.db);
      const obs: RecordedObservation[] = Object.entries(values).map(([property, result]) => ({
        featureId: id,
        property,
        result,
        seq: ++seq,
        runId: rid(800_000 + seq),
      }));
      ctx.seedObservations(obs);
      return seq;
    },
  };
}

export const tree = (n: number): FeatureId => fid(100 + n);

const actorOf = (id: string, role: string): Actor => ({
  id,
  kind: 'participant',
  roles: [role] as unknown as Actor['roles'],
});
export const anna = actorOf('anna', 'kontrolle');
export const bernd = actorOf('bernd', 'bauhof');
export const vera = actorOf('vera', 'verwaltung');

/** A device that applies pages exactly as docs/07 says (tombstones before edge rows). */
export class ModelDevice {
  readonly features = new Map<
    string,
    { properties: Readonly<Record<string, Json>>; type: string; lifecycle: LifecycleState }
  >();
  readonly edges = new Set<string>();
  readonly pages: SyncPage[] = [];
  /** Ids of every feature tombstone received, with whether the device held that feature at that moment. */
  readonly tombstoned: { id: string; held: boolean }[] = [];
  scope = '';
  cursor = 0;
  synced = false;

  apply(page: SyncPage): void {
    this.pages.push(page);
    for (const t of page.tombstones) {
      if (t.kind === 'feature') {
        this.tombstoned.push({ id: t.id, held: this.features.has(t.id) });
        this.features.delete(t.id);
        for (const k of [...this.edges]) {
          const [from, , to] = k.split('\u0000');
          if (from === t.id || to === t.id) this.edges.delete(k); // the device drops the edges of a dropped feature
        }
      } else if (t.kind === 'edge') this.edges.delete(t.id);
    }
    for (const f of page.features) {
      if (!isServed(f.lifecycle)) this.features.delete(f.id);
      else this.features.set(f.id, { properties: f.properties, type: f.type, lifecycle: f.lifecycle });
    }
    for (const e of page.edges) this.edges.add(edgeKey(e));
  }

  /** Pulls to the end of the server's data (snapshot first, delta afterwards), `limit` rows per page. */
  pull(service: SyncService, actor: Actor, limit?: number): void {
    for (let restarts = 0; restarts < 3; restarts++) if (this.run(service, actor, limit)) return;
    throw new Error('sync did not settle');
  }

  private run(service: SyncService, actor: Actor, limit?: number): boolean {
    const lim = limit === undefined ? {} : { limit };
    if (!this.synced) {
      let pin: number | undefined;
      let after = 0;
      for (;;) {
        const req: SyncRequest = {
          since: 0,
          scope: this.scope,
          v: SYNC_PROTOCOL_VERSION,
          ...(pin === undefined ? {} : { after, pin }),
          ...lim,
        };
        const page = service.page(actor, req);
        if (this.scope !== '' && page.header.scopeFingerprint !== this.scope) return this.reset(page);
        this.scope = page.header.scopeFingerprint;
        pin = page.header.head;
        this.apply(page);
        if (!page.header.more) break;
        after = page.header.cursor;
      }
      this.synced = true;
      this.cursor = pin;
    }
    for (;;) {
      const page = service.page(actor, {
        since: this.cursor,
        scope: this.scope,
        v: SYNC_PROTOCOL_VERSION,
        ...lim,
      });
      if (page.header.scopeFingerprint !== this.scope) return this.reset(page);
      this.apply(page);
      this.cursor = page.header.cursor;
      if (!page.header.more) return true;
    }
  }

  private reset(page: SyncPage): false {
    this.features.clear();
    this.edges.clear();
    this.synced = false;
    this.cursor = 0;
    this.scope = page.header.scopeFingerprint;
    return false;
  }
}
