/**
 * The simulation backend on the real server adapters: the run store over an in-memory SQLite project database,
 * the sync service, and the real run and sync HTTP handlers (Web `Request` in, `Response` out, no socket). The
 * transports the device gets are what the app would build from `fetch`: a body goes in, a status and a JSON
 * body come out and are decoded with the client's own `decodeRunReply` and `decodePayload`.
 *
 * Lives here, outside the package graph, because the client package may not import the server package.
 */
import { createGeo } from '../../../packages/core/src/geo';
import type { FeatureId, Json, Key, RunId } from '../../../packages/core/src/model';
import type { LifecycleState } from '../../../packages/core/src/registry/lifecycle';
import { MemoryStore } from '../../../packages/core/src/memory';
import { encodeRequest, SyncProtocolError } from '../../../packages/core/src/sync';
import { PLAN_MAX_RULE_DEPTH } from '../../../packages/core/src/plan';
import type { Actor } from '../../../packages/core/src/model';
import { SIM_CONFIG_VERSION, type FakeClock } from '../../../packages/core/src/testing';
import { decodeRunReply } from '../../../packages/client/src/queue';
import type { AuditedFeature, AuditedRun, ServerAudit, SimBackend } from '../../../packages/client/src/simulation/contract.testing';
import type { Principal } from '../../../packages/server/src/auth';
import { createLogger } from '../../../packages/server/src/log';
import { SESSION_COOKIES } from '../../../packages/server/src/auth/params';
import { createToolBell } from '../../../packages/server/src/modules/chat/tool-bell';
import { createRunHandlers } from '../../../packages/server/src/http/runs';
import { createSyncHandlers } from '../../../packages/server/src/http/sync';
import { createDoorbell, createSyncService } from '../../../packages/server/src/sync';
import { createVersionCache } from '../../../packages/server/src/store/run/config-for';
import { headSeq, setup } from '../../../packages/server/src/store/run/testkit';
import { mismatches } from '../../../packages/server/src/store/run/verify.testkit';
import type { Workload } from '../../../packages/core/src/testing';

const PROJECT = { id: 'p1', key: 'demo' } as const;

const principalOf = (actor: Actor): Principal => ({
  kind: actor.kind,
  id: actor.id,
  projectId: PROJECT.id,
  roles: actor.roles as readonly Key[],
});

export function sqliteBackend(workload: Workload, clock: FakeClock): SimBackend {
  const config = workload.config;
  const geo = createGeo();
  const ctx = setup({ config, clock, geo, limits: { ruleDepth: PLAN_MAX_RULE_DEPTH } });
  const service = createSyncService(ctx.db, { config: () => ({ version: 1, config }), at: () => config, versions: createVersionCache(() => config), clock, geo });
  const principals = new Map<string, Principal>();
  const runs = createRunHandlers({
    auth: {
      authenticate: (id) => (id ? (principals.get(id) ?? null) : null),
      toActor: (p) => ({ id: p.id, kind: p.kind, roles: p.roles }),
      rolesFor: () => [],
    },
    project: (key) => (key === PROJECT.key ? PROJECT : undefined),
    store: () => ctx.store,
    log: createLogger({ sink: () => undefined, now: () => 0 }),
  });
  const sync = createSyncHandlers({
    log: ctx.logs.log,
    project: (key) => (key === PROJECT.key ? PROJECT : undefined),
    rolesFor: () => [],
    service: () => service,
    doorbell: () => createDoorbell({ head: () => service.head(), pollMs: 0 }),
    toolBell: createToolBell(),
  });

  const session = (actor: Actor): Principal => {
    const p = principalOf(actor);
    principals.set(actor.id, p);
    return p;
  };

  return {
    config,
    head: () => headSeq(ctx.db),
    seed(fill) {
      const scratch = new MemoryStore(config, clock, geo, SIM_CONFIG_VERSION);
      fill(scratch);
      ctx.seedObservations(scratch.log);
    },
    runTransport(actor) {
      session(actor);
      return {
        async send(payload) {
          const single = payload.kind === 'run';
          const req = new Request(`http://sim/api/p/demo/runs${single ? '' : '/batch'}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIES.participant}=${actor.id}` },
            body: JSON.stringify(single ? payload.run : { runs: payload.runs }),
          });
          const res = await (single ? runs.submit : runs.batch)(req, { params: { project: PROJECT.key } });
          return decodeRunReply(res.status, await res.json());
        },
      };
    },
    syncTransport(actor) {
      const principal = session(actor);
      return {
        async fetchEncoded(request) {
          const url = `http://sim/api/p/demo/sync?${new URLSearchParams(encodeRequest(request))}`;
          const res = sync.sync({ request: new Request(url), project: PROJECT.key, principal });
          if (res.status === 200) return res.text();
          const body = (await res.json()) as { code?: string; error?: string };
          if (body.code === 'version_mismatch')
            throw new SyncProtocolError('version_mismatch', body.error ?? 'version_mismatch');
          throw new Error(`sync answered ${res.status}`);
        },
      };
    },
    submitDirect(batch) {
      ctx.store.submitBatch(batch);
    },
    audit(): ServerAudit {
      const rows = <T>(sql: string): T[] => ctx.db.prepare<T>(sql).all();
      const runRows = new Map<RunId, AuditedRun>(
        rows<{ id: string; outcome: string; actor_kind: string; caused_by: string | null }>(
          'SELECT id, outcome, actor_kind, caused_by FROM runs',
        ).map((r) => [
          r.id as RunId,
          {
            outcome: r.outcome as AuditedRun['outcome'],
            actorKind: r.actor_kind,
            causedBy: (r.caused_by ?? undefined) as RunId | undefined,
          },
        ]),
      );
      const features = new Map<FeatureId, AuditedFeature>(
        rows<{ id: string; type: string; properties: string; lifecycle: string }>(
          'SELECT id, type, properties, lifecycle FROM features',
        ).map((r) => [
          r.id as FeatureId,
          {
            type: r.type,
            properties: JSON.parse(r.properties) as Readonly<Record<string, Json>>,
            lifecycle: r.lifecycle as LifecycleState,
          },
        ]),
      );
      return {
        head: headSeq(ctx.db),
        runs: runRows,
        observations: rows<{ seq: number; run_id: string }>(
          'SELECT seq, run_id FROM observations ORDER BY seq',
        ).map((r) => ({ seq: r.seq, runId: r.run_id as RunId })),
        tombstoneSeqs: rows<{ seq: number }>('SELECT seq FROM tombstones ORDER BY seq').map((r) => r.seq),
        features,
        foldMismatches: mismatches(ctx).map((m) => m.what),
      };
    },
  };
}
