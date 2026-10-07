/**
 * The Projekte page's ⋮ menu talks to three endpoints (WP-383): `POST /api/admin/templates` ("Als Vorlage
 * veröffentlichen"), `POST /api/admin/projects/import` ("Aus Datei importieren") and
 * `GET /api/admin/projects/<project>/schema` ("Schema exportieren"). The page holds no second validation: the
 * server's answers are shown as they come.
 */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface Listing {
  readonly key: string;
  readonly version: string;
}

const parts = (v: string): number[] => (v.split('-')[0] ?? '').split('.').map((n) => Number(n) || 0);

/** The version the publish dialog starts with: `1.0.0` for a new key, else the next minor of its newest version. */
export function suggestVersion(templates: readonly Listing[], key: string): string {
  const listed = templates.filter((t) => t.key === key).map((t) => parts(t.version));
  const best = listed.sort(
    (a, b) => (b[0] ?? 0) - (a[0] ?? 0) || (b[1] ?? 0) - (a[1] ?? 0) || (b[2] ?? 0) - (a[2] ?? 0),
  )[0];
  return best === undefined ? '1.0.0' : `${best[0] ?? 1}.${(best[1] ?? 0) + 1}.0`;
}

/** v3's download name (`+page.svelte:78`): the project name lower-cased with dashes, then `-schema`. */
export function schemaFilename(projectName: string): string {
  return `${projectName.toLowerCase().replace(/\s+/g, '-')}-schema.yaml`;
}

export interface PublishValues {
  readonly project: string;
  readonly key: string;
  readonly version: string;
  readonly label: string;
}
export type PublishField = keyof Omit<PublishValues, 'project'>;
export type PublishOutcome =
  | { readonly ok: true; readonly key: string; readonly version: string }
  | {
      readonly ok: false;
      readonly fields: Partial<Record<PublishField, string>>;
      readonly message: string | null;
    };

const json = async (res: Response): Promise<Record<string, unknown>> =>
  ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {};

export async function publishAsTemplate(
  values: PublishValues,
  fetcher: Fetcher = fetch,
): Promise<PublishOutcome> {
  let res: Response;
  try {
    res = await fetcher('/api/admin/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
  } catch {
    return { ok: false, fields: {}, message: null };
  }
  const body = await json(res);
  if (res.status === 201 && typeof body['key'] === 'string' && typeof body['version'] === 'string')
    return { ok: true, key: body['key'], version: body['version'] };
  const fields: { -readonly [F in PublishField]?: string } = {};
  const problems = Array.isArray(body['problems'])
    ? (body['problems'] as { field?: unknown; message?: unknown }[])
    : [];
  for (const p of problems)
    if ((p.field === 'key' || p.field === 'version' || p.field === 'label') && typeof p.message === 'string')
      fields[p.field] = p.message;
  const messages = Array.isArray(body['messages']) ? (body['messages'] as unknown[]) : [];
  const first = messages.find((m): m is string => typeof m === 'string');
  return { ok: false, fields, message: first ?? null };
}

export interface FileProblem {
  readonly path: string;
  readonly message: string;
}
export type ImportOutcome =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly problems: readonly FileProblem[] };

export async function importProjectFile(file: File, fetcher: Fetcher = fetch): Promise<ImportOutcome> {
  const form = new FormData();
  form.set('file', file);
  let res: Response;
  try {
    res = await fetcher('/api/admin/projects/import', { method: 'POST', body: form });
  } catch {
    return { ok: false, problems: [] };
  }
  const body = await json(res);
  if (res.status === 201 && typeof body['key'] === 'string') return { ok: true, key: body['key'] };
  const raw = Array.isArray(body['problems'])
    ? (body['problems'] as { path?: unknown; message?: unknown }[])
    : [];
  const problems = raw.flatMap((p) =>
    typeof p.message === 'string'
      ? [{ path: typeof p.path === 'string' ? p.path : '', message: p.message }]
      : [],
  );
  return { ok: false, problems };
}

export async function exportSchema(
  project: string,
  fetcher: Fetcher = fetch,
): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false }> {
  try {
    const res = await fetcher(`/api/admin/projects/${encodeURIComponent(project)}/schema`, { method: 'GET' });
    return res.ok ? { ok: true, text: await res.text() } : { ok: false };
  } catch {
    return { ok: false };
  }
}
