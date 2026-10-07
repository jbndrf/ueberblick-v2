import { describe, expect, it, vi } from 'vitest';
import type { Draft, EnsureResult, PutResult, Principal } from '@ueberblick/server';
import { createDraftHandlers, MAX_OVERLAY_BYTES, type DraftDeps } from './builder-draft';

const admin = { kind: 'admin', id: 'admin-1' } as unknown as Principal;
const draft = (revision: number, overlay = 'extends: t@1\n'): Draft => ({
  template: 't',
  templateVersion: '1.0.0',
  overlay,
  revision,
  updatedBy: 'admin-1',
  updatedAt: '2026-09-30T08:00:00Z',
});

/** An in-memory draft behind the same compare-and-swap rule as the store. */
function fakes(initial: Draft | 'none', deny?: Response) {
  let current: Draft | undefined = initial === 'none' ? undefined : initial;
  const seeded: string[] = [];
  const deps: DraftDeps = {
    authorize: (principal) => deny ?? { projectKey: 'muster', principal: principal as Principal },
    ensure: (_project, by): EnsureResult => {
      seeded.push(by);
      return { ok: true, draft: current ?? (current = draft(1)) };
    },
    put: (_project, expected, overlay): PutResult => {
      if (!current || current.revision !== expected) return { ok: false, draft: current };
      current = { ...current, overlay, revision: current.revision + 1 };
      return { ok: true, draft: current };
    },
  };
  return { deps, seeded, state: () => current };
}
const noVersion: DraftDeps['ensure'] = () => ({ ok: false, code: 'no_version' });

const get = (h: ReturnType<typeof createDraftHandlers>) =>
  h.GET({ params: { project: 'muster' }, locals: { admin: admin } });
const put = (h: ReturnType<typeof createDraftHandlers>, body: unknown) =>
  h.PUT({
    params: { project: 'muster' },
    locals: { admin: admin },
    request: new Request('http://x/builder-api/muster/draft', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  });

describe('GET /builder-api/<project>/draft', () => {
  it('passes a refusal through unchanged (401/403/404 come from the admin check)', async () => {
    const h = createDraftHandlers(fakes('none', new Response('no', { status: 403 })).deps);
    const res = get(h);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('no');
  });

  it('creates the draft on the first read, as the calling admin, and returns it', async () => {
    const f = fakes('none');
    const res = get(createDraftHandlers(f.deps));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revision: 1, template: 't', overlay: 'extends: t@1\n' });
    expect(f.seeded).toEqual(['admin-1']);
  });

  it('answers 404 no_version when nothing is deployed', async () => {
    const res = get(createDraftHandlers({ ...fakes('none').deps, ensure: noVersion }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('no_version');
  });
});

describe('PUT /builder-api/<project>/draft', () => {
  it('stores the overlay for the current revision and answers the new one', async () => {
    const f = fakes(draft(3));
    const res = await put(createDraftHandlers(f.deps), { overlay: 'edited', revision: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: 4 });
    expect(f.state()?.overlay).toBe('edited');
  });

  it('answers 409 stale_revision with the current draft and changes nothing', async () => {
    const f = fakes(draft(3, 'theirs'));
    const res = await put(createDraftHandlers(f.deps), { overlay: 'mine', revision: 2 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; draft: Draft };
    expect(body.code).toBe('stale_revision');
    expect(body.draft).toMatchObject({ revision: 3, overlay: 'theirs' });
    expect(f.state()?.overlay).toBe('theirs');
  });

  it('answers 404 no_draft when the draft was never read (nothing to write to)', async () => {
    const res = await put(createDraftHandlers(fakes('none').deps), { overlay: 'x', revision: 1 });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('no_draft');
  });

  it('refuses a body that is not { overlay: string, revision: integer } with 400', async () => {
    const h = createDraftHandlers(fakes(draft(1)).deps);
    for (const bad of [
      'not json',
      {},
      { overlay: 1, revision: 1 },
      { overlay: 'x', revision: '1' },
      { overlay: 'x', revision: 1.5 },
    ])
      expect((await put(h, bad)).status).toBe(400);
  });

  it('refuses an overlay above the size limit with 413', async () => {
    const h = createDraftHandlers(fakes(draft(1)).deps);
    const res = await put(h, { overlay: 'x'.repeat(MAX_OVERLAY_BYTES + 1), revision: 1 });
    expect(res.status).toBe(413);
  });

  it('an oversized body is cut off while streaming and never parsed', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    const chunk = new TextEncoder().encode('{'.repeat(100_000));
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const h = createDraftHandlers(fakes(draft(1)).deps);
    const res = await h.PUT({
      params: { project: 'muster' },
      locals: { admin: admin },
      request: new Request('http://x/builder-api/muster/draft', {
        method: 'PUT',
        body,
        duplex: 'half',
      } as RequestInit),
    });
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(20); // 1 MB cap is 10 chunks of 100 kB, not the 100 MB on offer
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('a declared Content-Length above the limit is refused without reading the body', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled++;
      },
    });
    const h = createDraftHandlers(fakes(draft(1)).deps);
    const res = await h.PUT({
      params: { project: 'muster' },
      locals: { admin: admin },
      request: new Request('http://x/builder-api/muster/draft', {
        method: 'PUT',
        body,
        duplex: 'half',
        headers: { 'content-length': String(MAX_OVERLAY_BYTES + 1) },
      } as RequestInit),
    });
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1); // the stream primes itself once; the handler reads nothing
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('passes a refusal through unchanged', async () => {
    const h = createDraftHandlers(fakes(draft(1), new Response('no', { status: 401 })).deps);
    expect((await put(h, { overlay: 'x', revision: 1 })).status).toBe(401);
  });
});
