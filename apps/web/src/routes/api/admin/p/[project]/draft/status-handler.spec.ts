import { describe, expect, it } from 'vitest';
import type { DraftStatus } from '@ueberblick/server';
import { createDraftStatusHandler } from './status-handler';

const STATUS: DraftStatus = { dirty: true, neverPublished: false, problems: 2, revision: 4, type: 'baum' };
const call = { params: { project: 'muster' }, locals: { admin: null } };

describe('GET /api/admin/p/<project>/draft/status', () => {
  it('passes a refusal through unchanged', async () => {
    const h = createDraftStatusHandler({
      authorize: () => new Response('no', { status: 403 }),
      status: () => STATUS,
    });
    const res = h(call);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('no');
  });

  it('answers the status of the authorised project, uncached', async () => {
    const seen: string[] = [];
    const h = createDraftStatusHandler({
      authorize: (_p, project) => ({ projectKey: project }),
      status: (project) => (seen.push(project), STATUS),
    });
    const res = h(call);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(STATUS);
    expect(seen).toEqual(['muster']);
  });
});
