// Test kit of the chat tool: a mutable `ToolDataPort` and a host that mounts the tool over it. Tests only.
import { vi } from 'vitest';
import type { FeatureId, Instant, Seq } from '@ueberblick/core/model';
import { createToolHost } from '@ueberblick/ui';
import { testMap, testPorts } from '@ueberblick/ui/tool-testing';
import type { ToolDataCursor, ToolDataItem, ToolDataPort } from '@ueberblick/ui/tool-api';
import { createChatTool, type ChatDeps } from './chat-tool';

export const T0 = Date.parse('2026-10-02T08:00:00.000Z');

export function msg(
  n: number,
  author: string,
  body = `Nachricht ${n}`,
  over: Partial<ToolDataItem> = {},
): ToolDataItem {
  return {
    id: `m${n}`,
    seq: n as Seq,
    author,
    at: new Date(T0 + n * 60_000 * 10).toISOString() as Instant,
    body,
    mentions: { persons: [], features: [] },
    ...over,
  };
}

export interface FakeData extends ToolDataPort {
  list: ToolDataItem[];
  cursorNow: ToolDataCursor;
  /** Replaces the list and tells the subscribers, as the device does after a pull. */
  set(items: readonly ToolDataItem[]): void;
  readonly listeners: Set<() => void>;
}

export function fakeData(initial: readonly ToolDataItem[] = []): FakeData {
  const listeners = new Set<() => void>();
  const data: FakeData = {
    list: [...initial],
    cursorNow: { lastReadSeq: 0 as Seq, lastMentionSeq: 0 as Seq },
    listeners,
    items() {
      return data.list;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    append: vi.fn(async (body: string) => {
      const item = msg(data.list.length + 1, 'me', body, { seq: null });
      data.set([...data.list, item]);
      return item;
    }),
    get cursor() {
      return data.cursorNow;
    },
    markRead: vi.fn((seq: Seq) => {
      data.cursorNow = { lastReadSeq: seq, lastMentionSeq: data.cursorNow.lastMentionSeq };
      listeners.forEach((l) => l());
    }),
    retry: vi.fn(async (id: string) => data.list.find((i) => i.id === id) as ToolDataItem),
    discard: vi.fn(async () => {}),
    set(items) {
      data.list = [...items];
      listeners.forEach((l) => l());
    },
  };
  return data;
}

export function chatDeps(
  over: Partial<ChatDeps> = {},
): ChatDeps & { seeds: Set<() => void>; pushSeed(s: string): void } {
  let seed: string | undefined;
  const seeds = new Set<() => void>();
  return {
    self: () => 'me',
    nameOf: (id) => ({ anna: 'Anna', bo: 'Bo', me: 'Mia' })[id],
    people: () => [
      { id: 'anna', name: 'Anna' },
      { id: 'bo', name: 'Bo' },
    ],
    featureLabel: (id) => (id === 'f1' ? 'Linde 7' : undefined),
    seed: {
      take: () => {
        const s = seed;
        seed = undefined;
        return s;
      },
      subscribe: (fn) => {
        seeds.add(fn);
        return () => void seeds.delete(fn);
      },
    },
    seeds,
    pushSeed(s) {
      seed = s;
      seeds.forEach((f) => f());
    },
    ...over,
  };
}

export async function mountChat(
  data: ToolDataPort | undefined,
  deps: ChatDeps = chatDeps(),
  locale = 'de',
  openFeature: (id: FeatureId) => void = () => {},
) {
  const host = createToolHost({
    loaders: { chat: async () => createChatTool(deps) },
    ports: testPorts(),
    locale,
    ...(data === undefined ? {} : { data: { forTool: () => data } }),
  });
  const root = document.createElement('div');
  document.body.append(root);
  const handle = await host.mountPanel(root, {
    toolKey: 'chat',
    point: 'tools-sheet',
    startTask: () => {},
    map: testMap(),
    openFeature,
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (k) => k,
  });
  return { root, handle };
}

/** Gives the scroller of the mounted tool a layout (jsdom has none): its viewport and content height, and scroll offset. */
export function layout(
  root: HTMLElement,
  box: { viewport: number; content: number; top?: number },
): HTMLElement {
  const scroller = root.querySelector<HTMLElement>('[data-chat="log"]');
  if (scroller === null) throw new Error('no log');
  let top = box.top ?? 0;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, get: () => box.viewport },
    scrollHeight: { configurable: true, get: () => box.content },
    scrollTop: { configurable: true, get: () => top, set: (v: number) => (top = v) },
  });
  return scroller;
}
