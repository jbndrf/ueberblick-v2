// @vitest-environment jsdom
// WP-683 / B-020: the `ctx.data` port. A tool with `data: true` gets the port of its own key; any other tool, none.
import { describe, expect, it, vi } from 'vitest';
import {
  TOOL_API_VERSION,
  ToolHostError,
  type PanelToolContext,
  type ToolDataPort,
  type ToolDataSource,
} from './contract';
import { assertTool, defineTool } from './define';
import { createToolHost } from './host';
import { testMap, testPorts } from './testing';

const fakePort = (): ToolDataPort => ({
  items: () => [],
  subscribe: () => () => {},
  append: vi.fn(async (body: string) => ({
    id: 'a',
    seq: null,
    author: 'me',
    at: '2026-10-02T08:00:00.000Z',
    body,
    mentions: { persons: [], features: [] },
  })),
  cursor: { lastReadSeq: 0, lastMentionSeq: 0 },
  markRead: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
});

const tool = (key: string, data: boolean, seen: (ctx: PanelToolContext) => void) =>
  defineTool({
    key,
    contributes: ['tools-sheet'],
    ...(data ? { data: true as const } : {}),
    mount(_el, ctx) {
      seen(ctx);
      return { destroy: () => {} };
    },
  });

async function mount(key: string, data: boolean, source: ToolDataSource | undefined) {
  let ctx: PanelToolContext | undefined;
  const host = createToolHost({
    loaders: { [key]: async () => tool(key, data, (c) => (ctx = c)) },
    ports: testPorts(),
    ...(source ? { data: source } : {}),
  });
  await host.mountPanel(document.createElement('div'), {
    toolKey: key,
    point: 'tools-sheet',
    startTask: () => {},
    map: testMap(),
    openFeature: () => {},
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (t) => t,
  });
  return ctx as PanelToolContext;
}

describe('ctx.data', () => {
  it('bumps the tool API version to 3', () => {
    expect(TOOL_API_VERSION).toBe(3);
  });

  it('gives a tool that declares `data` the port of its own key', async () => {
    const asked: string[] = [];
    const port = fakePort();
    const ctx = await mount('chat', true, {
      forTool: (k) => {
        asked.push(k);
        return port;
      },
    });
    expect(ctx.data).toBe(port);
    expect(asked).toEqual(['chat']);
  });

  it('gives a tool without `data` no port, and never asks the source', async () => {
    const forTool = vi.fn(fakePort);
    const ctx = await mount('search', false, { forTool });
    expect(ctx.data).toBeUndefined();
    expect(forTool).not.toHaveBeenCalled();
  });

  it('gives no port when the app supplies no source', async () => {
    expect((await mount('chat', true, undefined)).data).toBeUndefined();
  });

  it('a source that has no stream for the tool (not offered) gives no port', async () => {
    const ctx = await mount('chat', true, { forTool: () => undefined });
    expect(ctx.data).toBeUndefined();
  });

  it('refuses `data` that is not `true`, and on a form-field tool', () => {
    const base = { key: 'x', api: TOOL_API_VERSION, mount: () => ({ destroy() {} }) };
    expect(() => assertTool({ ...base, contributes: ['tools-sheet'], data: 'yes' })).toThrow(ToolHostError);
    expect(() => assertTool({ ...base, contributes: ['form-field'], produces: 'file', data: true })).toThrow(
      ToolHostError,
    );
  });
});
