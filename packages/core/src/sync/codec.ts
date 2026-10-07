/**
 * Pure encode/decode between object pages and tuple pages (docs/07). Column order is fixed per
 * protocol version; decode maps by column name, so a reordered but complete list still decodes,
 * while an unknown or missing column is a typed error.
 */
import type { FeatureAudit, FeatureId, Json, Key, RunId } from '../model';
import { SYNC_OBSERVATION_HISTORY, SYNC_PROTOCOL_VERSION } from './contract';
import type {
  EncodedPage,
  SyncEdge,
  SyncObservation,
  SyncPage,
  SyncFeature,
  SyncPageHeader,
  SyncPerson,
  SyncRun,
  SyncTombstone,
  SyncVersions,
  TupleTable,
} from './contract';
import { LIFECYCLE_STATES, isServed, type LifecycleState } from '../registry/lifecycle';
import { SyncProtocolError } from './errors';
import { SYNC_PAGE_KINDS, SYNC_TOMBSTONE_KINDS, type SyncPageKind, type SyncTombstoneKind } from './registry';

const bad = (message: string): never => {
  throw new SyncProtocolError('malformed', message);
};

interface Column<R, V> {
  readonly name: string;
  readonly get: (row: R) => V;
}
type Row = Record<string, unknown>;

const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string =>
  typeof v === 'string' ? v : bad(`${what}: expected string`);
const num = (v: unknown, what: string): number =>
  typeof v === 'number' ? v : bad(`${what}: expected number`);
const bool = (v: unknown, what: string): boolean =>
  typeof v === 'boolean' ? v : bad(`${what}: expected boolean`);

/** A served feature is `active` or `completed`: archived and deleted ones leave a device by tombstone (docs/07). */
const servedLifecycle = (v: unknown): LifecycleState => {
  const s = str(v, 'feature.lifecycle');
  return LIFECYCLE_STATES.has(s) && isServed(s) ? s : bad(`feature.lifecycle: ${s} is not a served state`);
};

/** An audit field on the wire: a string, or null when the feature has none; absent from the state then. */
const audit = <K extends keyof FeatureAudit>(v: unknown, key: K): { readonly [P in K]?: string } =>
  v === null ? {} : ({ [key]: str(v, `feature.${key}`) } as { readonly [P in K]?: string });

const FEATURE_COLUMNS = [
  'id',
  'type',
  'version',
  'properties',
  'lifecycle',
  'createdBy',
  'createdAt',
  'changedAt',
  'updatedSeq',
] as const;
const EDGE_COLUMNS = ['from', 'relation', 'to', 'derived', 'updatedSeq'] as const;
const OBSERVATION_COLUMNS = ['featureId', 'property', 'result', 'phenomenonTime', 'seq', 'runId'] as const;
/** Additive column of `observations` (WP-794): an absent one reads as null. */
const OBSERVATION_OPTIONAL_COLUMNS = ['resultTime'] as const;
const TOMBSTONE_COLUMNS = ['seq', 'kind', 'id'] as const;
const RUN_COLUMNS = ['id', 'task', 'actor', 'clientTime', 'receivedAt', 'seq', 'causedBy'] as const;
const PERSON_COLUMNS = ['id', 'name'] as const;
/** Additive columns of `people` (WP-725): an absent one reads as "no information", never as an error. */
const PERSON_OPTIONAL_COLUMNS = ['choosable'] as const;

/** Canonical column lists per table, in wire order. */
export const SYNC_COLUMNS = {
  features: FEATURE_COLUMNS,
  edges: EDGE_COLUMNS,
  observations: [...OBSERVATION_COLUMNS, ...OBSERVATION_OPTIONAL_COLUMNS],
  tombstones: TOMBSTONE_COLUMNS,
  runs: RUN_COLUMNS,
  people: [...PERSON_COLUMNS, ...PERSON_OPTIONAL_COLUMNS],
} as const;

function toTable<R>(columns: readonly Column<R, unknown>[], rows: readonly R[]): TupleTable {
  return { columns: columns.map((c) => c.name), rows: rows.map((r) => columns.map((c) => c.get(r))) };
}

/** Validates the column list and returns, per canonical column, its index in the wire tuple. */
function indexColumns(
  table: unknown,
  canonical: readonly string[],
  what: string,
  optional: readonly string[] = [],
): { rows: unknown[][]; at: number[] } {
  if (!isRecord(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows))
    return bad(`${what}: not a table`);
  const columns = table.columns as unknown[];
  if (columns.some((c) => typeof c !== 'string')) return bad(`${what}: column names must be strings`);
  const at = canonical.map((name) => columns.indexOf(name));
  const missing = canonical.filter((_, i) => at[i] === -1);
  if (missing.length > 0)
    throw new SyncProtocolError('missing_column', `${what}: missing column ${missing.join(',')}`);
  at.push(...optional.map((name) => columns.indexOf(name)));
  const rows = table.rows as unknown[];
  for (const r of rows) if (!Array.isArray(r) || r.length !== columns.length) bad(`${what}: row width`);
  return { rows: rows as unknown[][], at };
}

const featureColumns: Column<SyncFeature, unknown>[] = [
  { name: 'id', get: (f) => f.id },
  { name: 'type', get: (f) => f.type },
  { name: 'version', get: (f) => f.version },
  { name: 'properties', get: (f) => f.properties },
  { name: 'lifecycle', get: (f) => f.lifecycle },
  { name: 'createdBy', get: (f) => f.createdBy ?? null },
  { name: 'createdAt', get: (f) => f.createdAt ?? null },
  { name: 'changedAt', get: (f) => f.changedAt ?? null },
  { name: 'updatedSeq', get: (f) => f.updatedSeq },
];
const edgeColumns: Column<SyncEdge, unknown>[] = [
  { name: 'from', get: (e) => e.from },
  { name: 'relation', get: (e) => e.relation },
  { name: 'to', get: (e) => e.to },
  { name: 'derived', get: (e) => e.derived },
  { name: 'updatedSeq', get: (e) => e.updatedSeq },
];
const observationColumns: Column<SyncObservation, unknown>[] = [
  { name: 'featureId', get: (o) => o.featureId },
  { name: 'property', get: (o) => o.property },
  { name: 'result', get: (o) => o.result },
  { name: 'phenomenonTime', get: (o) => o.phenomenonTime },
  { name: 'seq', get: (o) => o.seq },
  { name: 'runId', get: (o) => o.runId },
  { name: 'resultTime', get: (o) => o.resultTime },
];
const tombstoneColumns: Column<SyncTombstone, unknown>[] = [
  { name: 'seq', get: (t) => t.seq },
  { name: 'kind', get: (t) => t.kind },
  { name: 'id', get: (t) => t.id },
];

const runColumns: Column<SyncRun, unknown>[] = [
  { name: 'id', get: (r) => r.id },
  { name: 'task', get: (r) => r.task },
  { name: 'actor', get: (r) => r.actor },
  { name: 'clientTime', get: (r) => r.clientTime },
  { name: 'receivedAt', get: (r) => r.receivedAt },
  { name: 'seq', get: (r) => r.seq },
  { name: 'causedBy', get: (r) => r.causedBy },
];
const personColumns: Column<SyncPerson, unknown>[] = [
  { name: 'id', get: (p) => p.id },
  { name: 'name', get: (p) => p.name },
  { name: 'choosable', get: (p) => p.choosable === true },
];

/** A page holds at most SYNC_OBSERVATION_HISTORY observations per (feature, property). */
function checkHistory(observations: readonly SyncObservation[]): void {
  const counts = new Map<string, number>();
  for (const o of observations) {
    const key = `${o.featureId}\u0000${o.property}`;
    const n = (counts.get(key) ?? 0) + 1;
    if (n > SYNC_OBSERVATION_HISTORY)
      throw new SyncProtocolError(
        'history_exceeded',
        `more than ${SYNC_OBSERVATION_HISTORY} observations for ${o.featureId} ${o.property}`,
      );
    counts.set(key, n);
  }
}

export function encodePage(page: SyncPage): EncodedPage {
  checkHistory(page.observations);
  return {
    v: SYNC_PROTOCOL_VERSION,
    header: page.header,
    features: toTable(featureColumns, page.features),
    edges: toTable(edgeColumns, page.edges),
    observations: toTable(observationColumns, page.observations),
    tombstones: toTable(tombstoneColumns, page.tombstones),
    runs: toTable(runColumns, page.runs),
    people: toTable(personColumns, page.people),
  };
}

function decodeVersions(v: unknown): SyncVersions {
  if (!isRecord(v) || !Array.isArray(v.live)) return bad('header.versions: not an object');
  const deployed = num(v.deployed, 'header.versions.deployed');
  const live = (v.live as unknown[]).map((n) => num(n, 'header.versions.live'));
  if (!live.includes(deployed)) bad('header.versions.live: must contain the deployed version');
  return { deployed, live };
}

function decodeHeader(h: unknown): SyncPageHeader {
  if (!isRecord(h)) return bad('header: not an object');
  const kind = str(h.kind, 'header.kind');
  if (!SYNC_PAGE_KINDS.has(kind)) bad(`header.kind: unknown page kind ${kind}`);
  return {
    kind: kind as SyncPageKind,
    cursor: num(h.cursor, 'header.cursor'),
    head: num(h.head, 'header.head'),
    more: bool(h.more, 'header.more'),
    scopeFingerprint: str(h.scopeFingerprint, 'header.scopeFingerprint'),
    versions: decodeVersions(h.versions),
    ...(h.choosable === undefined ? {} : { choosable: str(h.choosable, 'header.choosable') }),
    ...(h.access === undefined ? {} : { access: str(h.access, 'header.access') }),
  };
}

/** `wire` is parsed JSON, untrusted. Throws `SyncProtocolError` on any deviation. */
export function decodePage(wire: unknown): SyncPage {
  const page = decodeUnchecked(wire);
  checkHistory(page.observations);
  return page;
}

function decodeUnchecked(wire: unknown): SyncPage {
  if (!isRecord(wire)) return bad('page: not an object');
  if (wire.v !== SYNC_PROTOCOL_VERSION)
    throw new SyncProtocolError(
      'version_mismatch',
      `protocol version ${String(wire.v)} received, ${SYNC_PROTOCOL_VERSION} supported`,
    );
  const header = decodeHeader(wire.header);
  const f = indexColumns(wire.features, FEATURE_COLUMNS, 'features');
  const e = indexColumns(wire.edges, EDGE_COLUMNS, 'edges');
  const o = indexColumns(
    wire.observations,
    OBSERVATION_COLUMNS,
    'observations',
    OBSERVATION_OPTIONAL_COLUMNS,
  );
  const t = indexColumns(wire.tombstones, TOMBSTONE_COLUMNS, 'tombstones');
  const ru = indexColumns(wire.runs, RUN_COLUMNS, 'runs');
  const pe = indexColumns(wire.people, PERSON_COLUMNS, 'people', PERSON_OPTIONAL_COLUMNS);
  return {
    header,
    features: f.rows.map((r): SyncFeature => {
      const [id, type, version, props, life, by, created, changed, seq] = f.at.map((i) => r[i]);
      return {
        id: str(id, 'feature.id') as FeatureId,
        type: str(type, 'feature.type') as Key,
        version: num(version, 'feature.version'),
        properties: isRecord(props) ? (props as { [k: string]: Json }) : bad('feature.properties'),
        lifecycle: servedLifecycle(life),
        ...audit(by, 'createdBy'),
        ...audit(created, 'createdAt'),
        ...audit(changed, 'changedAt'),
        updatedSeq: num(seq, 'feature.updatedSeq'),
      };
    }),
    edges: e.rows.map((r): SyncEdge => {
      const [from, relation, to, derived, seq] = e.at.map((i) => r[i]);
      return {
        from: str(from, 'edge.from') as FeatureId,
        relation: str(relation, 'edge.relation') as Key,
        to: str(to, 'edge.to') as FeatureId,
        derived: bool(derived, 'edge.derived'),
        updatedSeq: num(seq, 'edge.updatedSeq'),
      };
    }),
    observations: o.rows.map((r): SyncObservation => {
      const [fid, property, result, time, seq, run, rtime] = o.at.map((i) => (i === -1 ? null : r[i]));
      return {
        featureId: str(fid, 'observation.featureId') as FeatureId,
        property: str(property, 'observation.property'),
        result: result as Json,
        phenomenonTime: time === null ? null : str(time, 'observation.phenomenonTime'),
        seq: num(seq, 'observation.seq'),
        runId: str(run, 'observation.runId') as RunId,
        resultTime: rtime === null ? null : str(rtime, 'observation.resultTime'),
      };
    }),
    tombstones: t.rows.map((r): SyncTombstone => {
      const [seq, kind, id] = t.at.map((i) => r[i]);
      const k = str(kind, 'tombstone.kind');
      if (!SYNC_TOMBSTONE_KINDS.has(k)) bad(`tombstone.kind: unknown ${k}`);
      return { seq: num(seq, 'tombstone.seq'), kind: k as SyncTombstoneKind, id: str(id, 'tombstone.id') };
    }),
    runs: ru.rows.map((r): SyncRun => {
      const [id, task, actor, client, received, seq, cause] = ru.at.map((i) => r[i]);
      return {
        id: str(id, 'run.id') as RunId,
        task: str(task, 'run.task'),
        actor: actor === null ? null : str(actor, 'run.actor'),
        clientTime: client === null ? null : num(client, 'run.clientTime'),
        receivedAt: num(received, 'run.receivedAt'),
        seq: num(seq, 'run.seq'),
        causedBy: cause === null ? null : (str(cause, 'run.causedBy') as RunId),
      };
    }),
    people: pe.rows.map((r): SyncPerson => {
      const [id, name, choosable] = pe.at.map((i) => (i === -1 ? undefined : r[i]));
      if (choosable !== undefined && typeof choosable !== 'boolean')
        return bad('person.choosable: not a boolean');
      return choosable === true
        ? { id: str(id, 'person.id'), name: str(name, 'person.name'), choosable }
        : { id: str(id, 'person.id'), name: str(name, 'person.name') };
    }),
  };
}
