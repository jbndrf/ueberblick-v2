/**
 * The browser side of the Versions routes: implements the lens's `VersionsApi` over `fetch`. A deploy
 * first waits until the draft saver has written every edit, then names the revision the plan was
 * made from, so a deploy never runs on a draft the admin did not see (409 `stale`).
 */
import type { DeployOutcome, Mapping, PlanOutcome, VersionsApi, VersionsSnapshot } from '@ueberblick/builder';
import type { PublishOutcome, TemplateFile } from '@ueberblick/core';
import type { DraftSaver } from './draft-saver';

type Fetch = typeof fetch;

export function createVersionsClient(opts: {
  readonly project: string;
  readonly fetch: Fetch;
  /** The saver of the opened draft; null when there is no draft (nothing can be deployed). */
  readonly saver: () => DraftSaver | null;
  /** Called after an upgrade was deployed: the draft started again on the new template, so the page reloads it. */
  readonly onupgraded?: () => void;
}): VersionsApi {
  const base = `/builder-api/${opts.project}`;
  const get = async <T>(path: string): Promise<T> => {
    const res = await opts.fetch(`${base}/${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  const post = (path: string, body: unknown): Promise<Response> =>
    opts.fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** The answer of a deploy-like call is a `DeployOutcome` body for 200, 409 and 422; anything else failed. */
  async function outcome(send: () => Promise<Response>): Promise<DeployOutcome> {
    try {
      const res = await send();
      if ([200, 409, 422].includes(res.status)) {
        const body = (await res.json()) as DeployOutcome;
        if (typeof body === 'object' && body !== null && 'ok' in body) return body;
      }
    } catch {
      // network error: falls through
    }
    return { ok: false, reason: 'failed' };
  }

  return {
    snapshot: () => get<VersionsSnapshot>('versions'),
    versionFile: (version) => get<TemplateFile>(`versions/${version}`),

    /** Waits for the saver like a deploy, so the plan is of the draft the admin sees. */
    async plan(): Promise<PlanOutcome> {
      const saver = opts.saver();
      if (saver === null) return { warnings: [] };
      await saver.settled();
      return get<PlanOutcome>('plan');
    },

    async deploy(mappings: Readonly<Record<string, Mapping>>) {
      const saver = opts.saver();
      if (saver === null) return { ok: false, reason: 'stale' };
      await saver.settled();
      if (saver.conflicted()) return { ok: false, reason: 'stale' };
      return outcome(() => post('deploy', { revision: saver.revision(), mappings }));
    },

    rollback: (version) => outcome(() => post('rollback', { version })),
    async upgrade({ overlay, mappings }) {
      const r = await outcome(() => post('upgrade', { overlay, mappings }));
      if (r.ok) opts.onupgraded?.();
      return r;
    },

    async publish(templateSrc): Promise<PublishOutcome> {
      try {
        const res = await post('publish', { template: templateSrc });
        if ([200, 409, 422].includes(res.status)) return (await res.json()) as PublishOutcome;
      } catch {
        // falls through
      }
      return { ok: false, reason: 'failed' };
    },
  };
}
