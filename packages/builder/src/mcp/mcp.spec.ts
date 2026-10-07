// WP-211: the assistant tools. One test per acceptance box, plus properties.
import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { musterstadt } from '../testing/golden';
import {
  createMcpServer,
  issueConfirmation,
  MAX_OPS,
  type ConfirmationPort,
  type DraftPort,
  type JsonRpcResponse,
  type ToolContext,
} from './index';
import type { Op } from '../doc';

class Store implements DraftPort {
  revision = 1;
  overlay = musterstadt.overlaySrc;
  writes = 0;
  read() {
    return Promise.resolve({
      ok: true as const,
      draft: { templateSrc: musterstadt.templateSrc, overlaySrc: this.overlay, revision: this.revision },
    });
  }
  write(overlay: string, revision: number) {
    if (revision !== this.revision)
      return Promise.resolve({
        ok: false as const,
        code: 'stale_revision' as const,
        currentRevision: this.revision,
      });
    this.overlay = overlay;
    this.revision += 1;
    this.writes += 1;
    return Promise.resolve({ ok: true as const, revision: this.revision });
  }
}

function setup(clock = { t: 1_000_000 }) {
  const store = new Store();
  const confirmation: ConfirmationPort = {
    sign: (m) => createHmac('sha256', 'test-key').update(m).digest('hex'),
    now: () => clock.t,
    ttlMs: 60_000,
  };
  const ctx: ToolContext = { project: 'muster', draft: store, confirmation };
  return { store, ctx, clock, server: createMcpServer(ctx) };
}

let nextId = 1;
async function call(server: ReturnType<typeof setup>['server'], name: string, args: unknown) {
  const res = (await server.handle({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args },
  })) as JsonRpcResponse;
  const r = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  return {
    res,
    isError: r?.isError === true,
    value:
      r === undefined ? undefined : (JSON.parse(r.content[0]?.text ?? 'null') as Record<string, unknown>),
  };
}

const labelOp: Op = { kind: 'set', path: 'tasks.kontrolle.label', value: { de: 'Neu', en: 'New' } };
const brokenOp: Op = { kind: 'set', path: 'types.baum.properties.art.to', value: 'gibt_es_nicht' };

describe('protocol', () => {
  it('initialize, ping and tools/list answer; a notification gets no answer', async () => {
    const { server } = setup();
    const init = (await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })) as JsonRpcResponse;
    expect(init.result).toMatchObject({ capabilities: { tools: {} } });
    expect(await server.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).toMatchObject({ result: {} });
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list = (await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })) as JsonRpcResponse;
    const tools = (
      list.result as {
        tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
      }
    ).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'read_config',
      'read_problems',
      'read_schema',
      'propose',
      'simulate',
      'apply',
    ]);
    expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
    // Only `apply` writes.
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(['apply']);
  });

  it('rejects unknown methods, batches and non-requests', async () => {
    const { server } = setup();
    expect(await server.handle({ jsonrpc: '2.0', id: 1, method: 'nope' })).toMatchObject({
      error: { code: -32601 },
    });
    expect(await server.handle([])).toMatchObject({ error: { code: -32600 } });
    expect(await server.handle({ hello: 1 })).toMatchObject({ error: { code: -32600 } });
    expect(
      await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } }),
    ).toMatchObject({ error: { code: -32602 } });
  });
});

describe('every tool validates its input against a schema', () => {
  const bad: [string, unknown][] = [
    ['read_config', { section: 5 }],
    ['read_config', { extra: true }],
    ['read_problems', { locale: 'x' }],
    ['read_schema', { anything: 1 }],
    ['propose', { ops: [] }],
    ['propose', { ops: [{ kind: 'explode', path: 'a' }] }],
    ['propose', { ops: [{ kind: 'set', path: 'a' }], extra: 1 }],
    ['simulate', { actor: { kind: 'wizard' } }],
    ['simulate', { actor: { kind: 'admin' }, task: 'Not A Key' }],
    ['apply', { ops: [labelOp], baseRevision: 1 }],
    ['apply', { ops: [labelOp], baseRevision: -1, confirmation: 'abc' }],
  ];
  it.each(bad)('%s refuses %j with the issues named', async (name, args) => {
    const { server } = setup();
    const r = await call(server, name, args);
    expect(r.isError).toBe(true);
    expect(r.value).toMatchObject({ code: 'invalid_input' });
    expect((r.value?.['issues'] as string[]).length).toBeGreaterThan(0);
  });
});

describe('read tools', () => {
  it('read_config returns the effective file, or one section, with the revision', async () => {
    const { server } = setup();
    const all = await call(server, 'read_config', {});
    expect(all.isError).toBe(false);
    expect(all.value).toMatchObject({ revision: 1 });
    expect(Object.keys(all.value?.['config'] as object)).toContain('types');
    const tasks = await call(server, 'read_config', { section: 'tasks' });
    expect(Object.keys(tasks.value?.['config'] as object)).toContain('kontrolle');
    const none = await call(server, 'read_config', { section: 'gibt_es_nicht' });
    expect(none).toMatchObject({ isError: true, value: { code: 'unknown_section' } });
  });

  it('read_problems returns the panel list; read_schema the file JSON Schema', async () => {
    const { server } = setup();
    const p = await call(server, 'read_problems', {});
    expect(p.value).toMatchObject({ baseRevision: 1, count: 0, problems: [] });
    const s = await call(server, 'read_schema', {});
    expect(s.value).toMatchObject({ $id: 'https://ueberblick.app/schema/ueberblick-1.schema.json' });
  });

  it('a draft that is missing is reported, not thrown', async () => {
    const { ctx } = setup();
    const server = createMcpServer({
      ...ctx,
      draft: {
        read: () => Promise.resolve({ ok: false, code: 'no_version', message: 'Nothing deployed.' }),
        write: ctx.draft.write,
      },
    });
    expect(await call(server, 'read_config', {})).toMatchObject({
      isError: true,
      value: { code: 'no_version' },
    });
  });
});

describe('propose', () => {
  it('reports the diff, both overlay texts and the problems, and stores nothing', async () => {
    const { server, store } = setup();
    const r = await call(server, 'propose', { ops: [labelOp] });
    expect(r.isError).toBe(false);
    expect(r.value).toMatchObject({ baseRevision: 1, problemCount: { before: 0, after: 0 } });
    expect((r.value?.['changes'] as unknown[]).length).toBeGreaterThan(0);
    expect((r.value?.['overlay'] as { after: string }).after).toContain('Neu');
    expect(store.writes).toBe(0);
    expect(store.overlay).toBe(musterstadt.overlaySrc);
  });

  it('lists the problems a change causes', async () => {
    const { server } = setup();
    const r = await call(server, 'propose', { ops: [brokenOp] });
    // Either the op is refused (schema) or it leaves problems; it never passes silently.
    if (r.isError) expect(r.value).toMatchObject({ code: 'op_refused' });
    else expect((r.value?.['problems'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('names the refused op and stops', async () => {
    const { server } = setup();
    const r = await call(server, 'propose', {
      ops: [labelOp, { kind: 'set', path: 'not a path', value: 1 }],
    });
    expect(r).toMatchObject({ isError: true, value: { code: 'op_refused', index: 1 } });
  });
});

describe('simulate', () => {
  it('lists the tasks offered to an actor on a generated feature and dry-runs one', async () => {
    const { server, store } = setup();
    const r = await call(server, 'simulate', {
      actor: { kind: 'participant', roles: ['kontrolle'] },
      feature: { type: 'baum' },
      task: 'kontrolle',
      input: { vitalitaet: 'v2', befund: 'ok' },
    });
    expect(r.isError).toBe(false);
    const offered = (r.value?.['availability'] as { task: string }[]).map((a) => a.task);
    expect(offered).toContain('kontrolle');
    expect(r.value?.['result']).toBeDefined();
    expect(store.writes).toBe(0);
  });

  it('runs on the proposed file, and reports a file that does not compile', async () => {
    const { server } = setup();
    const r = await call(server, 'simulate', {
      ops: [brokenOp],
      actor: { kind: 'admin' },
      feature: { type: 'baum' },
    });
    expect(r.isError).toBe(true);
    expect(['does_not_compile', 'op_refused']).toContain(r.value?.['code']);
    const u = await call(server, 'simulate', {
      actor: { kind: 'admin' },
      feature: { type: 'gibt_es_nicht' },
    });
    expect(u.value).toMatchObject({ code: 'unknown_type' });
  });
});

describe('apply needs a human confirmation token', () => {
  const human = async (s: ReturnType<typeof setup>, ops: Op[], baseRevision = 1) => {
    const t = await issueConfirmation(s.ctx, { ops, baseRevision });
    if (!t.ok) throw new Error(t.refusal.message);
    return t.token;
  };

  it('without a token, with a made-up token: refused, nothing written', async () => {
    const s = setup();
    for (const confirmation of ['abc', '1.abc', `${s.clock.t + 1000}.${'0'.repeat(64)}`]) {
      const r = await call(s.server, 'apply', { ops: [labelOp], baseRevision: 1, confirmation });
      expect(r).toMatchObject({ isError: true, value: { code: 'confirmation_invalid' } });
    }
    expect(s.store.writes).toBe(0);
  });

  it('with the token: the overlay is written and the revision moves on', async () => {
    const s = setup();
    const token = await human(s, [labelOp]);
    const r = await call(s.server, 'apply', { ops: [labelOp], baseRevision: 1, confirmation: token });
    expect(r).toMatchObject({ isError: false, value: { revision: 2, deployed: false } });
    expect(s.store.overlay).toContain('Neu');
    expect(s.store.writes).toBe(1);
  });

  it('the token fits exactly one change: other ops, another revision, another project, or expired', async () => {
    const s = setup();
    const token = await human(s, [labelOp]);
    const other: Op = { kind: 'set', path: 'tasks.kontrolle.label', value: { de: 'Anders', en: 'Other' } };
    expect(
      await call(s.server, 'apply', { ops: [other], baseRevision: 1, confirmation: token }),
    ).toMatchObject({
      value: { code: 'confirmation_invalid' },
    });
    const elsewhere = createMcpServer({ ...s.ctx, project: 'other' });
    expect(
      await call(elsewhere, 'apply', { ops: [labelOp], baseRevision: 1, confirmation: token }),
    ).toMatchObject({
      value: { code: 'confirmation_invalid' },
    });
    s.clock.t += 61_000;
    expect(
      await call(s.server, 'apply', { ops: [labelOp], baseRevision: 1, confirmation: token }),
    ).toMatchObject({
      value: { code: 'confirmation_expired' },
    });
    expect(s.store.writes).toBe(0);
  });

  it('a stale write gets stale_revision like the draft endpoint (409), and nothing changes', async () => {
    const s = setup();
    const token = await human(s, [labelOp]);
    s.store.revision = 2; // somebody saved in the builder meanwhile
    const r = await call(s.server, 'apply', { ops: [labelOp], baseRevision: 1, confirmation: token });
    expect(r).toMatchObject({ isError: true, value: { code: 'stale_revision', currentRevision: 2 } });
    expect(s.store.writes).toBe(0);
    // A write that loses the race inside the store is the same answer.
    const racing: DraftPort = {
      read: () => s.store.read(),
      write: () => Promise.resolve({ ok: false, code: 'stale_revision', currentRevision: 9 }),
    };
    const server = createMcpServer({ ...s.ctx, draft: racing });
    s.store.revision = 1;
    const t2 = await issueConfirmation({ ...s.ctx, draft: racing }, { ops: [labelOp], baseRevision: 1 });
    if (!t2.ok) throw new Error('token');
    expect(
      await call(server, 'apply', { ops: [labelOp], baseRevision: 1, confirmation: t2.token }),
    ).toMatchObject({
      value: { code: 'stale_revision', currentRevision: 9 },
    });
  });

  it('the human step gives no token for a refused op or a draft that moved', async () => {
    const s = setup();
    expect(
      await issueConfirmation(s.ctx, { ops: [{ kind: 'set', path: 'x y', value: 1 }], baseRevision: 1 }),
    ).toMatchObject({ ok: false });
    expect(await issueConfirmation(s.ctx, { ops: [labelOp], baseRevision: 7 })).toMatchObject({
      ok: false,
      refusal: { code: 'stale_revision' },
    });
  });
});

describe('untrusted input limits', () => {
  it('too many ops, too large a value, too deep a value', async () => {
    const { server } = setup();
    const many = Array.from({ length: MAX_OPS + 1 }, () => labelOp);
    expect((await call(server, 'propose', { ops: many })).value).toMatchObject({ code: 'invalid_input' });
    const long = { kind: 'set', path: 'tasks.kontrolle.label', value: { de: 'x'.repeat(20_000), en: 'x' } };
    expect((await call(server, 'propose', { ops: [long] })).value).toMatchObject({ code: 'too_large' });
    let deep: unknown = 'x';
    for (let i = 0; i < 40; i++) deep = { a: deep };
    const nested = { kind: 'set', path: 'tasks.kontrolle.label', value: deep };
    expect((await call(server, 'propose', { ops: [nested] })).value).toMatchObject({ code: 'too_large' });
  });

  it('an expression nested beyond the untrusted limit is refused, one within it is accepted', async () => {
    const { server } = setup();
    const when = (n: number) => `${'('.repeat(n)}true${')'.repeat(n)}`;
    const op = (n: number): Op => ({ kind: 'set', path: 'tasks.kontrolle.when', value: when(n) });
    const deep = await call(server, 'propose', { ops: [op(30)] }); // config allows 64, untrusted 16
    expect(deep).toMatchObject({
      isError: true,
      value: { code: 'expression_limits', path: 'tasks.kontrolle.when' },
    });
    const ok = await call(server, 'propose', { ops: [op(3)] });
    expect(ok.value?.['code']).not.toBe('expression_limits');
  });

  it('property: whatever an assistant sends, a tool answers with a result and never throws', async () => {
    const { server, store } = setup();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'read_config',
          'read_problems',
          'read_schema',
          'propose',
          'simulate',
          'apply',
          'nope',
        ),
        fc.jsonValue(),
        async (name, args) => {
          const res = await server.handle({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          });
          expect(res).not.toBeNull();
          expect(store.writes).toBe(0); // no confirmation could have been guessed
        },
      ),
      { numRuns: 100 },
    );
  });
});
