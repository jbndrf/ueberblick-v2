/**
 * "Projekt erstellen" submits to `POST /api/admin/projects` (WP-309), the one write path: the same endpoint the
 * operator tools use, so the page holds no second validation. v3 posted a form action; v4 has no cookie-form
 * action because the API already answers field problems.
 */
import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';

/** A problem is a message of the catalogue (`key`) or the server's own text. */
export type Problem = { readonly key: AdminKey } | { readonly text: string };
export type FormProblems = { readonly [F in 'name' | 'description' | 'template' | 'form']?: Problem };
export interface FormValues {
  name: string;
  description: string;
  template: string;
}
export type CreateOutcome =
  { readonly ok: true; readonly key: string } | { readonly ok: false; readonly problems: FormProblems };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** The template reference the API takes: `key@major` of a listed `key` and `version`. */
export function templateRef(t: { readonly key: string; readonly version: string }): string {
  return `${t.key}@${t.version.split('.')[0] ?? '1'}`;
}

const FAILED: CreateOutcome = { ok: false, problems: { form: { key: 'project_new_failed' } } };
const FIELDS = ['name', 'description', 'template'] as const;

export async function createProject(values: FormValues, fetcher: Fetcher = fetch): Promise<CreateOutcome> {
  if (values.name.trim() === '')
    return { ok: false, problems: { name: { key: 'project_new_name_required' } } };
  let res: Response;
  try {
    res = await fetcher('/api/admin/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
  } catch {
    return FAILED;
  }
  const body = (await res.json().catch(() => ({}))) as {
    key?: unknown;
    problems?: { field?: unknown; message?: unknown }[];
  };
  if (res.status === 201 && typeof body.key === 'string') return { ok: true, key: body.key };
  const out: { -readonly [F in keyof FormProblems]: Problem } = {};
  for (const p of body.problems ?? [])
    for (const f of FIELDS) if (p.field === f && typeof p.message === 'string') out[f] = { text: p.message };
  return Object.keys(out).length > 0 ? { ok: false, problems: out } : FAILED;
}
