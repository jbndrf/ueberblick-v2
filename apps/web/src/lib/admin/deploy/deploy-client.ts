/**
 * The browser side of the deploy overview (WP-360): the dry run with the current choices, and the deploy with the
 * revision the plan was made from, the mappings and the choice per Objektart. Both are the builder routes
 * (`/builder-api/<project>/plan` and `.../deploy`), so an assistant or a role app (H3, H4) uses the same two calls.
 */
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import { isPreviewView, type PreviewView } from '../preview/types';
import type { DeployAnswer, DeployPlan, DeployRequest } from './types';

export interface DeployClient {
  /** The dry run of the saved draft, or null when it cannot be read. */
  plan(choices: DeployRequest['versions'], locale: Locale): Promise<DeployPlan | null>;
  deploy(request: DeployRequest): Promise<DeployAnswer>;
  /** The preview and its logins (WP-373, v3 "Vorschau-Logins"), or null when they cannot be read. */
  preview(locale: Locale): Promise<PreviewView | null>;
  /** "Demo-Daten zurücksetzen": a new preview with fresh demo data, the logins stay; null when it failed. */
  resetPreview(locale: Locale): Promise<PreviewView | null>;
  /** The whole project file as YAML text, live and draft (WP-506); `live` is null before the first deploy. Null when it cannot be read. */
  compare(): Promise<ProjectFiles | null>;
}

export interface ProjectFiles {
  readonly live: string | null;
  readonly draft: string | null;
}

/** The deploy body as the routes answer it (the builder's `DeployOutcome`; the shell stays free of the builder package at run time). */
type Outcome =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly reason: 'problems'; readonly problems: readonly unknown[] }
  | { readonly ok: false; readonly reason: string };

const isPlan = (v: unknown): v is DeployPlan =>
  typeof v === 'object' &&
  v !== null &&
  Array.isArray((v as DeployPlan).groups) &&
  Array.isArray((v as DeployPlan).mappings) &&
  Array.isArray((v as DeployPlan).blockers);

export function createDeployClient(opts: {
  readonly project: string;
  readonly fetch: typeof fetch;
}): DeployClient {
  const base = `/builder-api/${opts.project}`;
  async function previewCall(method: 'GET' | 'POST', locale: Locale): Promise<PreviewView | null> {
    try {
      const url =
        method === 'GET' ? `${base}/preview?locale=${locale}` : `${base}/preview/reset?locale=${locale}`;
      const res = await opts.fetch(url, { method });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return isPreviewView(body) ? body : null;
    } catch {
      return null;
    }
  }
  return {
    async compare() {
      try {
        const res = await opts.fetch(`${base}/compare`);
        if (!res.ok) return null;
        const body = (await res.json()) as Partial<ProjectFiles>;
        return typeof body === 'object' && body !== null && 'live' in body && 'draft' in body
          ? (body as ProjectFiles)
          : null;
      } catch {
        return null;
      }
    },
    preview: (locale) => previewCall('GET', locale),
    resetPreview: (locale) => previewCall('POST', locale),

    async plan(choices, locale) {
      try {
        const query = new URLSearchParams({ locale });
        if (Object.keys(choices).length > 0) query.set('versions', JSON.stringify(choices));
        const res = await opts.fetch(`${base}/plan?${query}`);
        if (!res.ok) return null;
        const body: unknown = await res.json();
        return isPlan(body) ? body : null;
      } catch {
        return null;
      }
    },

    async deploy(request) {
      let out: Outcome;
      try {
        const res = await opts.fetch(`${base}/deploy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        });
        if (![200, 409, 422].includes(res.status)) return { kind: 'failed' };
        out = (await res.json()) as Outcome;
      } catch {
        return { kind: 'failed' };
      }
      if (out.ok) return { kind: 'deployed', version: out.version };
      if ('problems' in out) return { kind: 'problems', count: out.problems.length };
      return out.reason === 'stale' || out.reason === 'mapping_required'
        ? { kind: out.reason }
        : { kind: 'failed' };
    },
  };
}
