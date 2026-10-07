/**
 * The ⋮ menu's ZIP, CSV and GeoPackage items and "ZIP importieren" talk to the endpoints of WP-384 (S3-8). Export is
 * v3's fetch, blob, anchor click (`+page.svelte:193-249`); the import is v3's upload then poll (`:271-346`), with
 * the upload as one streamed request (`XMLHttpRequest`, for upload progress) instead of v3's numbered chunks.
 */
type Fetcher = (url: string) => Promise<Response>;

/** The export endpoints of a project (the last path segment). */
export const EXPORT_KINDS = { zip: 'zip', csv: 'csv', gpkg: 'gpkg' } as const;
export type ExportKind = keyof typeof EXPORT_KINDS;

export const exportUrl = (project: string, kind: ExportKind): string =>
  `/api/admin/p/${encodeURIComponent(project)}/export/${EXPORT_KINDS[kind]}`;

/** v3 `cd.match(/filename="([^"]+)"/)` (`+page.svelte:230-231`). */
export function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const m = /filename="([^"]+)"/.exec(disposition ?? '');
  return m?.[1] ?? fallback;
}

export type Download =
  { readonly ok: true; readonly blob: Blob; readonly filename: string } | { readonly ok: false };

export async function fetchDownload(
  url: string,
  fallbackName: string,
  fetcher: Fetcher = (u) => fetch(u),
): Promise<Download> {
  try {
    const res = await fetcher(url);
    if (!res.ok) return { ok: false };
    return {
      ok: true,
      blob: await res.blob(),
      filename: filenameFromDisposition(res.headers.get('content-disposition'), fallbackName),
    };
  } catch {
    return { ok: false };
  }
}

/** Hands a blob to the browser as a file (v3: object URL and a clicked anchor). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The slice of `XMLHttpRequest` the upload uses (injected in tests). */
interface Xhr {
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  status: number;
  responseText: string;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
}

export type UploadOutcome =
  { readonly ok: true; readonly job: string } | { readonly ok: false; readonly status: number };

/** Sends the ZIP as the request body; `onProgress` gets the percent sent (v3 `onProgress`). */
export function uploadArchive(
  file: File,
  name: string,
  onProgress: (percent: number, loaded: number, total: number) => void,
  makeXhr: () => Xhr = () => new XMLHttpRequest() as unknown as Xhr,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const typed = name.trim();
    const xhr = makeXhr();
    xhr.open(
      'POST',
      `/api/admin/projects/import-zip${typed === '' ? '' : `?name=${encodeURIComponent(typed)}`}`,
    );
    // The server's request carries no body when the header is absent (a file the browser cannot type, such as a
    // misnamed one, sends none), so the type is always named.
    xhr.setRequestHeader('content-type', 'application/zip');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0)
        onProgress(Math.round((100 * e.loaded) / e.total), e.loaded, e.total);
    };
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { job?: unknown };
        if (xhr.status === 202 && typeof body.job === 'string') return resolve({ ok: true, job: body.job });
      } catch {
        // falls through to the failure
      }
      resolve({ ok: false, status: xhr.status });
    };
    xhr.send(file);
  });
}

export interface ImportJob {
  readonly id: string;
  /** `IMPORT_JOB_STATES` of the core registry. */
  readonly state: string;
  readonly done: number;
  readonly total: number;
  readonly key?: string;
  /** Participants that got new login links because theirs were in use on the instance (A-046). */
  readonly renewedTokens?: number;
  readonly problems?: readonly {
    readonly path: string;
    readonly message: string;
    /** Set when a limit refused the archive (`ARCHIVE_PROBLEM_CODES`). */
    readonly code?: string;
  }[];
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** v3 `pollImportStatus` (`+page.svelte:271-299`): every second until the job is done or failed. */
export async function pollImport(
  job: string,
  onUpdate: (job: ImportJob) => void,
  fetcher: Fetcher = (u) => fetch(u),
  delay: (ms: number) => Promise<void> = wait,
): Promise<ImportJob> {
  for (;;) {
    await delay(1000);
    let res: Response;
    try {
      res = await fetcher(`/api/admin/projects/import-zip/${job}`);
    } catch {
      continue;
    }
    // an unknown job is one the server lost (a restart): the import cannot be followed any more
    if (res.status === 404) return { id: job, state: 'failed', done: 0, total: 0 };
    if (!res.ok) continue;
    const { job: j } = (await res.json()) as { job: ImportJob };
    onUpdate(j);
    if (j.state === 'done' || j.state === 'failed') return j;
  }
}
