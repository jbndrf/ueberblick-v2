/**
 * The browser side of WP-363's import endpoints: the dry run, the job and its polling. The wizard never batches or
 * re-validates rows (R1): the server plans the file, steps the submit and reports `rows_done` of `rows_total`.
 */
import type { MappingBody } from './mapping';

export interface ImportProblemView {
  readonly row: number;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface PlanCounts {
  readonly valid: number;
  readonly problem_rows: number;
  readonly problems: number;
}

export interface PreviewRow {
  readonly row: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface JobView {
  readonly state: string;
  readonly rows_done: number;
  readonly rows_total: number;
  readonly imported?: number;
  readonly outcome?: string | null;
  readonly problems?: readonly ImportProblemView[];
  readonly problem_count?: number;
  readonly error?: string | null;
}

export type ImportFailure = { readonly kind: 'error'; readonly code: string; readonly message: string };
export type PlanResult =
  | {
      readonly kind: 'ok';
      readonly counts: PlanCounts;
      readonly problems: readonly ImportProblemView[];
      readonly preview: readonly PreviewRow[];
    }
  | ImportFailure;
export type RunResult = { readonly kind: 'done'; readonly job: JobView } | ImportFailure;

export interface RunOptions {
  readonly mode: 'atomic' | 'skip';
  readonly replace: boolean;
}

export interface ImportClient {
  plan(file: File, mapping: MappingBody): Promise<PlanResult>;
  /** Starts the job and polls it until it is done or failed; `onProgress` sees every state read. */
  run(
    file: File,
    mapping: MappingBody,
    options: RunOptions,
    onProgress: (job: JobView) => void,
  ): Promise<RunResult>;
}

const POLL_MS = 300;
const POLL_RETRIES = 3;

const network = (): ImportFailure => ({
  kind: 'error',
  code: 'network',
  message: 'The server could not be reached.',
});

async function failure(res: Response): Promise<ImportFailure> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return {
      kind: 'error',
      code: body.error?.code ?? `http_${res.status}`,
      message: body.error?.message ?? '',
    };
  } catch {
    return { kind: 'error', code: `http_${res.status}`, message: '' };
  }
}

export function createImportClient(opts: {
  readonly project: string;
  readonly fetch: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}): ImportClient {
  const base = `/api/admin/p/${opts.project}/import`;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const body = (file: File, mapping: MappingBody, extra: Readonly<Record<string, string>> = {}): FormData => {
    const form = new FormData();
    form.set('file', file);
    form.set('mapping', JSON.stringify(mapping));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  };

  return {
    async plan(file, mapping) {
      try {
        const res = await opts.fetch(`${base}/plan`, { method: 'POST', body: body(file, mapping) });
        if (!res.ok) return await failure(res);
        const out = (await res.json()) as Omit<Extract<PlanResult, { kind: 'ok' }>, 'kind'>;
        return { kind: 'ok', counts: out.counts, problems: out.problems, preview: out.preview };
      } catch {
        return network();
      }
    },

    async run(file, mapping, options, onProgress) {
      let id: string;
      try {
        const res = await opts.fetch(base, {
          method: 'POST',
          body: body(file, mapping, { mode: options.mode, replace: String(options.replace) }),
        });
        if (!res.ok) return await failure(res);
        id = ((await res.json()) as { job: string }).job;
      } catch {
        return network();
      }
      let misses = 0;
      for (;;) {
        try {
          const res = await opts.fetch(`${base}/${id}`);
          if (!res.ok) return await failure(res);
          const { job } = (await res.json()) as { job: JobView };
          misses = 0;
          onProgress(job);
          if (job.state === 'done' || job.state === 'failed') return { kind: 'done', job };
        } catch {
          misses += 1;
          if (misses >= POLL_RETRIES) return network();
        }
        await sleep(POLL_MS);
      }
    },
  };
}
