import { describe, expect, it } from 'vitest';
import { docWithProblems, musterstadt } from '../../../../../packages/builder/src/testing/golden';
import type { DraftSources } from '$lib/admin/draft/draft-source.server';
import { createProblemsHandler } from './problems-handler';

const clean: DraftSources = { templateSrc: musterstadt.templateSrc, overlaySrc: musterstadt.overlaySrc };
const broken: DraftSources = {
  templateSrc: musterstadt.templateSrc,
  overlaySrc: docWithProblems().save().overlaySrc,
};

function call(draft: DraftSources | null, query = '', deny?: Response) {
  const handler = createProblemsHandler({
    authorize: () => deny ?? { projectKey: 'muster' },
    loadDraft: () => draft,
  });
  return handler({
    params: { project: 'muster' },
    locals: { admin: null },
    url: new URL(`http://x/builder-api/muster/problems${query}`),
  });
}

describe('GET /builder-api/<project>/problems', () => {
  it('passes a refusal through unchanged (401/403/404 come from the admin check)', async () => {
    const res = call(clean, '', new Response('no', { status: 403 }));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('no');
  });

  it('answers 404 no_draft while there is no draft', async () => {
    const res = call(null);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('no_draft');
  });

  it('returns the report of the draft: revision, count and the problems with path and location', async () => {
    const res = call(broken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      revision: string;
      count: number;
      problems: { path: string; code: string; location: object }[];
    };
    expect(body.count).toBe(body.problems.length);
    expect(body.problems[0]).toMatchObject({
      path: 'types.baum.properties.art.to',
      code: 'dangling_reference',
      location: { type: 'baum' },
    });
    expect(body.revision).toMatch(/\S/);
  });

  it('a clean draft has no problems', async () => {
    const body = (await call(clean).json()) as { count: number };
    expect(body.count).toBe(0);
  });

  it('answers 422 not_openable for a draft that does not fit together', async () => {
    const res = call({ templateSrc: clean.templateSrc, overlaySrc: 'extends: nope@1\n' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('not_openable');
  });
});
