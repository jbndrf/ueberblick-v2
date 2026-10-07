// @vitest-environment jsdom
/**
 * Budget (B-020, WP-684, docs/12 interaction to next paint <= 200 ms): opening the Projekt-Chat panel over a stream of
 * 10,000 messages. The thread groups the messages once (O(messages), no DOM) and draws a window of groups, so the
 * DOM holds about twenty groups, never 10,000; a new message regroups and redraws the window; the Werkzeuge badge walks
 * the unread tail only. jsdom builds DOM slower than a browser, so the numbers are upper bounds.
 * Run: npm test -- -c bench/vitest.config.ts bench/chat-panel
 */
import { describe, expect, it } from 'vitest';
import type { Instant, Seq } from '../../packages/core/src/model';
import { createToolHost } from '../../packages/ui/src';
import { testMap, testPorts } from '../../packages/ui/src/tool-host/testing';
import type { ToolDataItem, ToolDataPort } from '../../packages/ui/src/tool-host/contract';
import { createChatTool } from '../../packages/tools/chat/src/chat-tool';
import { chatBadge } from '../../apps/web/src/lib/participant/tools/chat-badge';
import { defineBudget, docBudget, report } from '../harness/budget.mjs';

const N = 10_000;
const T0 = Date.parse('2026-10-02T08:00:00.000Z');
const items = (n: number): ToolDataItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    seq: (i + 1) as Seq,
    // five authors in blocks, a few minutes apart: groups of mixed size, chips in every tenth body
    author: ['anna', 'bo', 'me', 'zoe', 'k6hjabcdef12345'][Math.floor(i / 3) % 5] as string,
    at: new Date(T0 + i * 90_000).toISOString() as Instant,
    body:
      i % 10 === 0 ? `Hallo @anna schau #f${i} bitte` : `Nachricht ${i} mit etwas mehr Text zum Umbrechen`,
    mentions: { persons: [], features: [] },
  }));

function port(list: ToolDataItem[]): ToolDataPort {
  return {
    items: () => list,
    subscribe: () => () => undefined,
    append: async () => list[0] as ToolDataItem,
    cursor: { lastReadSeq: 0 as Seq, lastMentionSeq: 0 as Seq },
    markRead: () => undefined,
    retry: async () => list[0] as ToolDataItem,
    discard: async () => undefined,
  };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

async function mount(data: ToolDataPort): Promise<{ ms: number; root: HTMLElement }> {
  const host = createToolHost({
    loaders: {
      chat: async () =>
        createChatTool({
          self: () => 'me',
          nameOf: (id) => ({ anna: 'Anna', bo: 'Bo', me: 'Mia', zoe: 'Zoe' })[id],
          people: () => [{ id: 'anna', name: 'Anna' }],
          featureLabel: () => undefined,
          seed: { take: () => undefined, subscribe: () => () => undefined },
        }),
    },
    ports: testPorts(),
    locale: 'de',
    data: { forTool: () => data },
  });
  const root = document.createElement('div');
  document.body.append(root);
  const t = performance.now();
  await host.mountPanel(root, {
    toolKey: 'chat',
    point: 'tools-sheet',
    startTask: () => undefined,
    map: testMap(),
    openFeature: () => undefined,
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (k) => k,
  });
  return { ms: performance.now() - t, root };
}

describe('Projekt-Chat panel over 10,000 messages', () => {
  it('opens within the interaction budget and draws a window, not every message', async () => {
    const list = items(N);
    await mount(port(list)); // warm up: JIT and the tool's lazy import are not the open
    const runs: number[] = [];
    let domGroupCount = 0;
    for (let k = 0; k < 7; k++) {
      document.body.replaceChildren();
      const { ms, root } = await mount(port(list));
      runs.push(ms);
      domGroupCount = root.querySelectorAll('[data-chat="group"]').length;
    }
    expect(domGroupCount).toBeGreaterThan(0);
    expect(domGroupCount).toBeLessThan(60);
    const open = median(runs);
    process.stdout.write(
      `chat-panel: open with ${N} messages median ${open.toFixed(1)} ms, ${domGroupCount} groups in the DOM\n`,
    );
    report(
      docBudget('interaction-to-next-paint', { id: 'chat-panel-open-10k', device: 'x4', thread: 'main' }),
      Number(open.toFixed(1)),
    );
  });

  it('a new message regroups and redraws within the interaction budget', async () => {
    const list = items(N);
    const subscribers = new Set<() => void>();
    const data: ToolDataPort = {
      ...port(list),
      items: () => list,
      subscribe: (fn) => (subscribers.add(fn), () => subscribers.delete(fn)),
    };
    await mount(data);
    const runs: number[] = [];
    for (let k = 0; k < 7; k++) {
      list.push({
        ...(list[0] as ToolDataItem),
        id: `n${k}`,
        seq: (N + k + 1) as Seq,
        author: 'anna',
        at: new Date(T0 + (N + k) * 90_000).toISOString() as Instant,
      });
      const t = performance.now();
      subscribers.forEach((f) => f());
      runs.push(performance.now() - t);
    }
    const ms = median(runs);
    process.stdout.write(`chat-panel: a new message over ${N} median ${ms.toFixed(1)} ms\n`);
    report(
      docBudget('long-task', { id: 'chat-panel-new-message-10k', device: 'x4', thread: 'main' }),
      Number(ms.toFixed(1)),
    );
  });

  it('the Werkzeuge badge walks the unread tail only (cost does not follow the history)', () => {
    const cost = (n: number): number => {
      const list = items(n);
      const cursor = { lastReadSeq: (n - 20) as Seq, lastMentionSeq: 0 as Seq }; // 20 unread
      const runs: number[] = [];
      for (let k = 0; k < 9; k++) {
        const t = performance.now();
        for (let r = 0; r < 200; r++) chatBadge(list, cursor, 'me');
        runs.push((performance.now() - t) / 200);
      }
      return median(runs);
    };
    const small = cost(1_000);
    const big = cost(N);
    process.stdout.write(
      `chat-panel: badge over 1,000 ${small.toFixed(4)} ms, over ${N} ${big.toFixed(4)} ms\n`,
    );
    report(
      defineBudget({
        id: 'chat-badge-growth',
        limit: 3,
        unit: 'ratio',
        derivedFrom:
          'never O(messages) per change (R14): the badge over 10,000 messages over the badge over 1,000, 20 unread (floored at 0.002 ms)',
        device: 'measured',
      }),
      Number((big / Math.max(small, 0.002)).toFixed(2)),
    );
  });
});
