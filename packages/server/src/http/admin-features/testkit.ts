/** Test support: a project database with the golden config and a few hand-written feature rows. */
import type { CompiledConfig } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { Db } from '../../db/driver';
import { golden, setup, type Ctx } from '../../store/run/testkit';
import { createAdminFeatureHandlers, type FeaturePage } from './index';

const ADMIN = { kind: 'admin', id: 'a1' } as unknown as Principal;
const NAMES: Readonly<Record<string, string>> = { a1: 'Admin Eins' };

/** The deps of the write side (`correct`) over a test context. */
export const writeDeps = (ctx: Ctx) => ({
  store: () => ctx.store,
  ids: ctx.deps.ids,
  clock: ctx.deps.clock,
  adminName: (id: string): string | null => NAMES[id] ?? null,
});

export interface Seed {
  id: string;
  stage?: string;
  befund?: string | null;
  hoehe_m?: number;
  kontrolle_faellig?: boolean;
  tags?: string[];
  lifecycle?: string;
  by?: string | null;
  at?: string;
  type?: string;
  /** Extra raw properties, written as they are. */
  props?: Record<string, unknown>;
}

export function insert(db: Db, s: Seed): void {
  const props: Record<string, unknown> = {};
  if (s.stage !== undefined) props['stage'] = s.stage;
  if (s.befund !== undefined && s.befund !== null) props['befund'] = s.befund;
  if (s.hoehe_m !== undefined) props['hoehe_m'] = s.hoehe_m;
  if (s.kontrolle_faellig !== undefined) props['kontrolle_faellig'] = s.kontrolle_faellig;
  Object.assign(props, s.props);
  db.prepare(
    `INSERT INTO features (id, type, config_version, properties, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, ?, 1, ?, 7.1, 50.7, 1, ?, ?, ?, ?)`,
  ).run(
    s.id,
    s.type ?? 'baum',
    JSON.stringify(props),
    s.lifecycle ?? 'active',
    s.by === undefined ? 'anna' : s.by,
    s.at ?? '2026-01-01T00:00:00.000Z',
    s.at ?? '2026-01-01T00:00:00.000Z',
  );
}

export function world(tweak: (c: CompiledConfig) => CompiledConfig = (c) => c) {
  const ctx = setup({ config: tweak(golden('musterstadt-plain')) });
  const handlers = createAdminFeatureHandlers({
    authorizeAdmin: (p, key) =>
      p === null
        ? new Response('no', { status: 401 })
        : p.kind !== 'admin'
          ? new Response('no', { status: 403 })
          : { projectKey: key },
    db: () => ctx.db,
    ...writeDeps(ctx),
    deployed: () => ({ version: 1, config: ctx.config }),
  });
  const call = (path: string, principal: Principal | null = ADMIN) => ({
    request: new Request(`http://x/api/admin/p/demo/${path}`),
    params: { project: 'demo' },
    principal,
  });
  const list = async (q: string): Promise<FeaturePage> =>
    (await handlers.list(call(`features?type=baum&${q}`)).json()) as FeaturePage;
  const distinct = async (q: string) =>
    (await handlers.distinct(call(`features/distinct?type=baum&${q}`)).json()) as {
      value: unknown;
      count: number;
    }[];
  return { ctx, db: ctx.db, handlers, call, list, distinct };
}

export const ids = (p: FeaturePage) => p.rows.map((r) => r.$id);
