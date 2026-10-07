import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Draft, EnsureResult, PutResult, Principal } from '@ueberblick/server';
import { musterstadt } from '../../../../../../packages/builder/src/testing/golden';
import { createMcpHandlers, MAX_MCP_BYTES, type McpDeps } from './handler';

const admin = { kind: 'admin', id: 'admin-1' } as unknown as Principal;
const labelOp = { kind: 'set', path: 'tasks.kontrolle.label', value: { de: 'Neu', en: 'New' } };

function setup(deny?: Response) {
  let current: Draft = {
    template: 'baumkataster',
    templateVersion: '1.0.0',
    overlay: musterstadt.overlaySrc,
    revision: 1,
    updatedBy: null,
    updatedAt: 't',
  };
  const clock = { t: 5_000 };
  const deps: McpDeps = {
    authorize: (principal) => deny ?? { projectKey: 'muster', principal: principal as Principal },
    ensure: (): EnsureResult => ({ ok: true, draft: current }),
    put: (_p, expected, overlay): PutResult => {
      if (current.revision !== expected) return { ok: false, draft: current };
      current = { ...current, overlay, revision: current.revision + 1 };
      return { ok: true, draft: current };
    },
    templateSource: () => musterstadt.templateSrc,
    confirmation: {
      sign: (m) => createHmac('sha256', 'k').update(m).digest('hex'),
      now: () => clock.t,
      ttlMs: 1000,
    },
  };
  const h = createMcpHandlers(deps);
  const req = (body: string, headers: Record<string, string> = {}) => ({
    params: { project: 'muster' },
    locals: { admin: admin },
    request: new Request('http://x/api/mcp/muster', { method: 'POST', body, headers }),
  });
  const rpc = async (name: string, args: unknown) => {
    const res = await h.POST(
      req(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })),
    );
    const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    return {
      status: res.status,
      isError: body.result.isError === true,
      value: JSON.parse(body.result.content[0]?.text ?? 'null') as Record<string, unknown>,
    };
  };
  const confirm = (body: unknown, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
    h.confirm(req(JSON.stringify(body), headers));
  return {
    h,
    req,
    rpc,
    confirm,
    state: () => current,
    bump: () => (current = { ...current, revision: current.revision + 1 }),
  };
}

describe('POST /api/mcp/<project>', () => {
  it('passes the admin check refusal through unchanged', async () => {
    const s = setup(new Response('no', { status: 403 }));
    expect((await s.h.POST(s.req('{}'))).status).toBe(403);
    expect(await s.confirm({})).toHaveProperty('status', 403);
  });

  it('answers tools/list; a notification is 202; broken JSON is 400; an oversized body 413', async () => {
    const s = setup();
    const list = await s.h.POST(s.req(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })));
    expect(((await list.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(6);
    expect(
      (await s.h.POST(s.req(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })))).status,
    ).toBe(202);
    expect((await s.h.POST(s.req('{nope'))).status).toBe(400);
    expect((await s.h.POST(s.req(' '.repeat(MAX_MCP_BYTES + 1)))).status).toBe(413);
    expect((await s.h.POST(s.req('{}', { 'content-length': String(MAX_MCP_BYTES + 1) }))).status).toBe(413);
  });

  it('reads the draft through the draft handler and proposes without writing', async () => {
    const s = setup();
    const p = await s.rpc('propose', { ops: [labelOp] });
    expect(p.isError).toBe(false);
    expect(p.value['baseRevision']).toBe(1);
    expect(s.state().revision).toBe(1);
  });

  it('apply: refused without the human token; with it the draft moves one revision; stale gets the 409 words', async () => {
    const s = setup();
    expect(
      (await s.rpc('apply', { ops: [labelOp], baseRevision: 1, confirmation: 'x.y' })).value['code'],
    ).toBe('confirmation_invalid');
    expect(s.state().revision).toBe(1);

    const issued = await s.confirm({ ops: [labelOp], baseRevision: 1 });
    expect(issued.status).toBe(200);
    const { token } = (await issued.json()) as { token: string };
    const ok = await s.rpc('apply', { ops: [labelOp], baseRevision: 1, confirmation: token });
    expect(ok.value).toMatchObject({ revision: 2, deployed: false });
    expect(s.state().overlay).toContain('Neu');

    const again = await s.rpc('apply', { ops: [labelOp], baseRevision: 1, confirmation: token });
    expect(again).toMatchObject({ isError: true, value: { code: 'stale_revision', currentRevision: 2 } });
  });
});

describe('anonymous callers', () => {
  it('get 401 from POST and from /confirm, and nothing is read or written', async () => {
    const s = setup(new Response('Sign in first.', { status: 401 }));
    const anon = (body: string) => ({
      params: { project: 'muster' },
      locals: { admin: null },
      request: new Request('http://x/api/mcp/muster', {
        method: 'POST',
        body,
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
    });
    expect((await s.h.POST(anon('{}'))).status).toBe(401);
    expect((await s.h.confirm(anon('{}'))).status).toBe(401);
    expect(s.state().revision).toBe(1);
  });
});

describe('POST /api/mcp/<project>/confirm', () => {
  it('is a browser action of the builder: refused without a same-origin request', async () => {
    const s = setup();
    const r = await s.confirm({ ops: [labelOp], baseRevision: 1 }, {});
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('human_only');
  });

  it('400 for a malformed body, 409 for a moved draft, 422 for a refused op', async () => {
    const s = setup();
    expect((await s.confirm({ ops: 'x' })).status).toBe(400);
    expect((await s.confirm({ ops: [labelOp], baseRevision: 9 })).status).toBe(409);
    expect(
      (await s.confirm({ ops: [{ kind: 'set', path: 'not a path', value: 1 }], baseRevision: 1 })).status,
    ).toBe(422);
  });
});
