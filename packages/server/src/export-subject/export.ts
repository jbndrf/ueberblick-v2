import { SHA256_PATTERN } from '../blobs';
import { createChatStore } from '../modules/chat/store';
import type { ProjectExport } from './contract';
import { EXPORT_FORMAT, EXPORT_VERSION, ManifestSchema, type Manifest } from './manifest';
import { personalProperties } from './personal';
import { subjectQueries, type ExportObservation } from './query';
import { createZip } from './zip';

type FileEntry = Manifest['files'][number];

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};
const CHUNK = 64 * 1024;
const enc = new TextEncoder();

/** Parses a stored JSON result; the export shows values, not their storage form. */
const parse = (s: string | null): unknown => (s === null ? null : (JSON.parse(s) as unknown));

/** Collects `{ sha256 }` attachment references anywhere inside a value. */
function collectShas(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) for (const v of value) collectShas(v, into);
  else if (typeof value === 'object' && value !== null) {
    const sha = (value as Record<string, unknown>).sha256;
    if (typeof sha === 'string' && SHA256_PATTERN.test(sha)) into.add(sha);
    for (const v of Object.values(value)) collectShas(v, into);
  }
}

/** Newline-delimited JSON in chunks of about 64 KiB: memory stays bounded whatever the subject holds. */
function* ndjson(rows: Iterable<unknown>): Generator<Uint8Array> {
  let buf = '';
  for (const row of rows) {
    buf += `${JSON.stringify(row)}\n`;
    if (buf.length >= CHUNK) {
      yield enc.encode(buf);
      buf = '';
    }
  }
  if (buf !== '') yield enc.encode(buf);
}

/**
 * A ZIP with everything the project holds about one subject (Art. 15 access, Art. 20 portability), streamed.
 * Files: `participant.json` (when the subject is a participant), `runs.ndjson`, `observations.ndjson`, `messages.ndjson`,
 * `features.geojson`, `blobs/<sha256>.<ext>` and `manifest.json` last. Format: packages/server/README.md.
 * The access is logged before the first byte; the log holds actor, subject id and time, no values.
 */
export function exportSubject(
  project: ProjectExport,
  subjectId: string,
  actor: string,
): AsyncGenerator<Uint8Array> {
  const at = project.clock.now();
  project.accessLog.record({ at, actor, action: 'export_subject', subject: subjectId });
  return build(project, subjectId, at);
}

async function* build(project: ProjectExport, subjectId: string, at: string): AsyncGenerator<Uint8Array> {
  const personal = personalProperties(project.config.file);
  const q = subjectQueries(project.db, subjectId, personal);
  const zip = createZip(at);
  const files: FileEntry[] = [];
  const shas = new Set<string>();
  // latest value per feature and property that is in the export: the source of features.geojson
  const latest = new Map<string, Map<string, unknown>>();

  async function* entry(
    path: string,
    kind: FileEntry['kind'],
    chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
    records: () => number | undefined,
    extra: { sha256?: string; mime?: string } = {},
  ): AsyncGenerator<Uint8Array> {
    let bytes = 0;
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const c of chunks) {
        bytes += c.length;
        yield c;
      }
    }
    yield* zip.add(path, counted());
    const n = records();
    files.push({ path, kind, ...(n === undefined ? {} : { records: n }), bytes, ...extra });
  }

  const who = q.participant();
  if (who !== undefined) {
    const body = { ...who, roles: parse(who.roles), attrs: parse(who.attrs) };
    yield* entry(
      'participant.json',
      'participant',
      [enc.encode(`${JSON.stringify(body, null, 2)}\n`)],
      () => 1,
    );
  }

  let runCount = 0;
  function* runRows(): Generator<unknown> {
    for (const r of q.runs()) {
      runCount++;
      const { value: input, redacted } = q.scope.redactInput(r.id, parse(r.input));
      const result = parse(r.result);
      collectShas(input, shas);
      yield { ...r, input, result: redacted ? q.scope.redactResult(result) : result };
    }
  }
  yield* entry('runs.ndjson', 'runs', ndjson(runRows()), () => runCount);

  let obsCount = 0;
  function* obsRows(): Generator<unknown> {
    for (const o of q.observations()) {
      obsCount++;
      const value = parse(o.result);
      collectShas(value, shas);
      keepLatest(latest, o, value);
      yield {
        seq: o.seq,
        feature: o.feature,
        property: o.property,
        value,
        phenomenon_time: o.phenomenon_time,
        via: o.via,
        ...(o.run === undefined ? {} : { run: o.run, task: o.task, received_at: o.received_at }),
      };
    }
  }
  yield* entry('observations.ndjson', 'observations', ndjson(obsRows()), () => obsCount);

  // The chat messages the subject wrote or that mention them (B-020), found through the mention index.
  let messageCount = 0;
  function* messageRows(): Generator<unknown> {
    for (const m of createChatStore(project.db, project.clock).aboutSubject(subjectId)) {
      messageCount++;
      yield m;
    }
  }
  yield* entry('messages.ndjson', 'messages', ndjson(messageRows()), () => messageCount);

  function* geojson(): Generator<Uint8Array> {
    yield enc.encode('{"type":"FeatureCollection","features":[');
    let first = true;
    for (const [id, props] of latest) {
      const type = q.featureType(id);
      const declared = type === undefined ? undefined : project.config.file.types?.[type]?.properties;
      let geometry: unknown = null;
      const properties: Record<string, unknown> = type === undefined ? {} : { $type: type };
      for (const [k, v] of props) {
        if (declared?.[k]?.type === 'geometry' && geometry === null) geometry = v;
        else properties[k] = v;
      }
      yield enc.encode(
        `${first ? '' : ','}\n${JSON.stringify({ type: 'Feature', id, geometry, properties })}`,
      );
      first = false;
    }
    yield enc.encode('\n]}\n');
  }
  yield* entry('features.geojson', 'features', geojson(), () => latest.size);

  const missing: string[] = [];
  for (const sha of [...shas].sort()) {
    const blob = project.blobs.get(sha);
    if (blob === undefined) {
      missing.push(sha);
      continue;
    }
    const ext = EXTENSIONS[blob.mime] ?? 'bin';
    yield* entry(`blobs/${sha}.${ext}`, 'blob', blob.stream, () => undefined, {
      sha256: sha,
      mime: blob.mime,
    });
  }

  const manifest: Manifest = ManifestSchema.parse({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    project: project.key,
    config_version: project.configVersion,
    generated_at: at,
    subject: { id: subjectId },
    files,
    properties: personal.map((p) => ({
      type: p.type,
      property: p.property,
      subject: p.subject,
      ...(p.label === undefined ? {} : { label: p.label }),
    })),
    missing_blobs: missing,
  });
  yield* zip.add('manifest.json', [enc.encode(`${JSON.stringify(manifest, null, 2)}\n`)]);
  yield* zip.finish();
}

function keepLatest(latest: Map<string, Map<string, unknown>>, o: ExportObservation, value: unknown): void {
  let props = latest.get(o.feature);
  if (props === undefined) latest.set(o.feature, (props = new Map()));
  props.set(o.property, value);
}
