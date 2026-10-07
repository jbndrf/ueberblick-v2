/**
 * The browser side of the Beziehungen page: one function per write over the page's own route, and the count of
 * features that hold a relation over the admin feature list (WP-313): the type's `total` minus the `total` of those with
 * no parent, two one-row calls, exact at any size (`features/distinct` caps at 500 values). Every answer is a `CallResult`: done, or the refusal already
 * in the page language, so a component shows a message and never reads a status.
 */
import { EMPTY_VALUE } from '../data/columns';
import type { CallResult, DeletePreview, RelationCall, RelationValues } from './types';

export type Language = 'de' | 'en';
type Fetch = typeof fetch;

export interface RelationsApi {
  create(values: RelationValues): Promise<CallResult<{ id: string }>>;
  update(id: string, patch: Partial<RelationValues>): Promise<CallResult<{ id: string }>>;
  /** What deleting this relation would break (the Doc's problems). Changes nothing. */
  preview(id: string): Promise<CallResult<DeletePreview>>;
  remove(id: string): Promise<CallResult<null>>;
  /** How many (live) features of `child` hold a parent in `refKey`; 0 when the type is not deployed yet. */
  holding(child: string, refKey: string): Promise<number>;
}

interface Refusal {
  readonly message?: { readonly de?: string; readonly en?: string };
}

export function createRelationsApi(opts: {
  readonly project: string;
  readonly language: Language;
  readonly fetch: Fetch;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
}): RelationsApi {
  const project = encodeURIComponent(opts.project);
  const page = `/admin/projects/${project}/relations`;

  async function call<T>(body: RelationCall, read: (answer: unknown) => T): Promise<CallResult<T>> {
    try {
      const res = await opts.fetch(page, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer: unknown = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, value: read(answer) };
      return { ok: false, message: (answer as Refusal).message?.[opts.language] ?? opts.fallback };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }
  const idOf = (a: unknown): { id: string } => ({ id: String((a as { id?: unknown }).id ?? '') });

  return {
    create: (values) => call({ action: 'create', ...values }, idOf),
    update: (id, patch) => call({ action: 'update', id, ...patch }, idOf),
    preview: (id) => call({ action: 'uses', id }, (a) => a as DeletePreview),
    remove: (id) => call({ action: 'delete', id }, () => null),
    async holding(child, refKey) {
      const total = async (filter?: Record<string, string>): Promise<number | null> => {
        try {
          const q = new URLSearchParams({ type: child, limit: '1', ...filter });
          const res = await opts.fetch(`/api/admin/p/${project}/features?${q}`);
          if (!res.ok) return null;
          const page = (await res.json()) as { total?: unknown };
          return typeof page.total === 'number' ? page.total : null;
        } catch {
          return null;
        }
      };
      const [all, none] = await Promise.all([total(), total({ [`filter.${refKey}`]: EMPTY_VALUE })]);
      return all === null || none === null ? 0 : Math.max(0, all - none);
    },
  };
}
