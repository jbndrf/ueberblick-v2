/**
 * The browser side of the Versionen page: the page's calls over `fetch`. Rollback and upgrade are the builder routes
 * `/builder-api/<project>/{rollback,upgrade}` (a deploy answers 200, 409 or 422 with a `DeployOutcome` body); compare
 * reads the two stored files from `versions/<n>` and groups them with `buildPlan` (the pure plan of the builder);
 * "Entwurf verwerfen" and "Auf aktuelle Version verschieben" (WP-368) are this page's own routes. JSON bodies, so the
 * calls need no form (CSRF) round trip.
 */
import { buildPlan, type DeployOutcome } from '@ueberblick/builder';
import { localize, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { PinMoveView } from '../../../../../../lib/admin/deploy/pin-move-view';
import type { ActionAnswer, MoveAnswer, MovePlanAnswer, VersionsCalls } from './types';

type Fetch = typeof fetch;

const FAILED = { ok: false, reason: 'failed' } as const;

function answer(o: DeployOutcome): ActionAnswer {
  if (o.ok) return { ok: true, version: o.version, warnings: o.warnings };
  return { ok: false, reason: o.reason, paths: o.reason === 'mapping_required' ? o.paths : [] };
}

export function createVersionsCalls(opts: {
  readonly project: string;
  readonly fetch: Fetch;
}): VersionsCalls {
  const api = `/builder-api/${opts.project}`;
  const post = (url: string, body: unknown): Promise<Response> =>
    opts.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function send(url: string, body: unknown): Promise<ActionAnswer> {
    try {
      const res = await post(url, body);
      if ([200, 409, 422].includes(res.status)) {
        const o = (await res.json()) as DeployOutcome;
        if (typeof o === 'object' && o !== null && 'ok' in o) return answer(o);
      }
    } catch {
      // a network error is a failed call
    }
    return FAILED;
  }

  const file = async (version: number): Promise<TemplateFile> => {
    const res = await opts.fetch(`${api}/versions/${version}`);
    if (!res.ok) throw new Error(`version ${version}: ${res.status}`);
    return (await res.json()) as TemplateFile;
  };

  /** The first problem of a 422 body as text in the admin's language; the engine writes both. */
  const reasonOf = (body: unknown, locale: string): string => {
    const problems = (body as { problems?: { message?: LocalizedString }[] } | null)?.problems;
    return localize(problems?.[0]?.message, [locale]) || 'failed';
  };
  const move = `/admin/projects/${opts.project}/versions/move`;

  return {
    async movePlan(version, locale): Promise<MovePlanAnswer> {
      try {
        const res = await opts.fetch(`${move}?${new URLSearchParams({ version: String(version), locale })}`);
        const body = (await res.json()) as { ok?: boolean; view?: PinMoveView };
        if (res.ok && body.ok === true && body.view !== undefined) return { ok: true, view: body.view };
        return { ok: false, reason: reasonOf(body, locale) };
      } catch {
        return FAILED;
      }
    },

    async movePins(version, mappings, locale): Promise<MoveAnswer> {
      try {
        const res = await post(move, { version, mappings });
        const body = (await res.json()) as { ok?: boolean; to?: number; unpinned?: number };
        if (res.ok && body.ok === true) return { ok: true, to: body.to ?? 0, unpinned: body.unpinned ?? 0 };
        return { ok: false, reason: reasonOf(body, locale) };
      } catch {
        return FAILED;
      }
    },

    rollback: (version) => send(`${api}/rollback`, { version }),
    upgrade: (overlay, mappings) => send(`${api}/upgrade`, { overlay, mappings }),

    async compare(from, to) {
      try {
        const [a, b] = await Promise.all([file(from), file(to)]);
        return { ok: true, plan: buildPlan({ deployed: a, effective: b, featureCounts: {} }) };
      } catch {
        return FAILED;
      }
    },

    async discard() {
      try {
        const res = await post(`/admin/projects/${opts.project}/versions/discard`, {});
        return res.ok ? { ok: true } : { ok: false, reason: 'no_version' };
      } catch {
        return FAILED;
      }
    },
  };
}
