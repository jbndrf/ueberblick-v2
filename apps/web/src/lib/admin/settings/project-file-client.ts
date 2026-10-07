/** The browser side of "Projektdatei": read the draft's project file, apply a whole one (`settings/project-file`). */
export interface FileProblem {
  readonly path: string;
  readonly message: string;
}

export type LoadResult =
  { readonly ok: true; readonly text: string; readonly revision: number } | { readonly ok: false };
export type ApplyResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly conflict: boolean; readonly problems: readonly FileProblem[] };

export function createProjectFileClient(project: string, fetcher: typeof fetch) {
  const url = `/admin/projects/${encodeURIComponent(project)}/settings/project-file`;
  return {
    async load(): Promise<LoadResult> {
      try {
        const res = await fetcher(url);
        if (!res.ok) return { ok: false };
        const b = (await res.json()) as { text: string; revision: number };
        return { ok: true, text: b.text, revision: b.revision };
      } catch {
        return { ok: false };
      }
    },
    async apply(text: string, revision: number): Promise<ApplyResult> {
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, revision }),
        });
        const b = (await res.json().catch(() => ({}))) as { revision?: number; problems?: FileProblem[] };
        if (res.ok && typeof b.revision === 'number') return { ok: true, revision: b.revision };
        return { ok: false, conflict: res.status === 409, problems: b.problems ?? [] };
      } catch {
        return { ok: false, conflict: false, problems: [] };
      }
    },
  };
}
