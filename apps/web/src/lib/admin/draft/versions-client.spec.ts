import { describe, expect, it, vi } from 'vitest';
import type { DraftSaver } from './draft-saver';
import { createVersionsClient } from './versions-client';

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function saver(over: Partial<DraftSaver> = {}): DraftSaver {
  return {
    save: () => undefined,
    settled: async () => undefined,
    revision: () => 5,
    conflicted: () => false,
    ...over,
  };
}
const client = (f: typeof fetch, s: DraftSaver | null = saver(), onupgraded?: () => void) =>
  createVersionsClient({
    project: 'muster',
    fetch: f,
    saver: () => s,
    ...(onupgraded ? { onupgraded } : {}),
  });

describe('createVersionsClient', () => {
  it('deploy waits for the saver, then sends the saved revision and the mappings', async () => {
    const order: string[] = [];
    const f = vi.fn(async () => {
      order.push('post');
      return res(200, { ok: true, version: 2, created: true, warnings: [] });
    }) as unknown as typeof fetch;
    const s = saver({
      settled: async () => {
        order.push('settled');
      },
    });
    const r = await client(f, s).deploy({ p: { discard: true } });
    expect(r).toEqual({ ok: true, version: 2, created: true, warnings: [] });
    expect(order).toEqual(['settled', 'post']);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/builder-api/muster/deploy');
    expect(JSON.parse(init.body as string)).toEqual({ revision: 5, mappings: { p: { discard: true } } });
  });

  it('plan waits for the saver, then reads the warnings of the saved draft', async () => {
    const order: string[] = [];
    const f = vi.fn(async () => {
      order.push('get');
      return res(200, { warnings: [{ path: 'a', code: 'c', message: 'm', hint: 'h' }] });
    }) as unknown as typeof fetch;
    const s = saver({
      settled: async () => {
        order.push('settled');
      },
    });
    const r = await client(f, s).plan();
    expect(r.warnings).toHaveLength(1);
    expect(order).toEqual(['settled', 'get']);
    expect((f as unknown as { mock: { calls: [string][] } }).mock.calls[0]?.[0]).toBe(
      '/builder-api/muster/plan',
    );
  });

  it('plan without a draft or after a failure has no warnings', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await client(f, null).plan()).toEqual({ warnings: [] });
    expect(f).not.toHaveBeenCalled();
    const bad = (async () => res(500, {})) as unknown as typeof fetch;
    await expect(client(bad).plan()).rejects.toThrow();
  });

  it('deploy is stale without a draft or after a conflict, and sends nothing', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await client(f, null).deploy({})).toEqual({ ok: false, reason: 'stale' });
    expect(await client(f, saver({ conflicted: () => true })).deploy({})).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('passes the server outcomes through: 409 mapping_required, 422 problems; other statuses and network errors fail', async () => {
    const answer = (status: number, body: unknown) =>
      client((async () => res(status, body)) as unknown as typeof fetch).rollback(1);
    expect(await answer(409, { ok: false, reason: 'mapping_required', paths: ['a'] })).toEqual({
      ok: false,
      reason: 'mapping_required',
      paths: ['a'],
    });
    expect(await answer(422, { ok: false, reason: 'problems', problems: [] })).toMatchObject({
      reason: 'problems',
    });
    expect(await answer(500, { code: 'x' })).toEqual({ ok: false, reason: 'failed' });
    expect(await answer(200, 'text')).toEqual({ ok: false, reason: 'failed' });
    const down = client((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
    expect(await down.rollback(1)).toEqual({ ok: false, reason: 'failed' });
  });

  it('upgrade tells the page to reload the draft only when it succeeded', async () => {
    const reloaded = vi.fn();
    const ok = client(
      (async () =>
        res(200, { ok: true, version: 3, created: true, warnings: [] })) as unknown as typeof fetch,
      saver(),
      reloaded,
    );
    await ok.upgrade({ overlay: 'x', mappings: {} });
    expect(reloaded).toHaveBeenCalledTimes(1);
    const refused = client(
      (async () => res(409, { ok: false, reason: 'stale' })) as unknown as typeof fetch,
      saver(),
      reloaded,
    );
    await refused.upgrade({ overlay: 'x', mappings: {} });
    expect(reloaded).toHaveBeenCalledTimes(1);
  });

  it('snapshot and versionFile read the GET routes and throw on an error status', async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith('/versions') ? res(200, { versions: [] }) : res(404, {}),
    ) as unknown as typeof fetch;
    const c = client(f);
    expect(await c.snapshot()).toEqual({ versions: [] });
    await expect(c.versionFile(9)).rejects.toThrow();
  });

  it('publish answers the server outcome, and failed on a network error', async () => {
    const refused = { ok: false, reason: 'refused', codes: ['breaking_in_minor'], messages: ['m'] };
    expect(await client((async () => res(409, refused)) as unknown as typeof fetch).publish('t')).toEqual(
      refused,
    );
    expect(
      await client((async () => Promise.reject(new Error('x'))) as unknown as typeof fetch).publish('t'),
    ).toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});
