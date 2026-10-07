// @vitest-environment jsdom
// Two devices of one project (WP-684; the browser e2e needs a deployed project with the chat declared, which the
// shared e2e world does not have): A writes, the server rings the tool doorbell, B pulls and its open panel shows the
// message; B's badge counts the mention until B has the panel open. Each device is the real client service over its
// own store and outbox, the real auto-sync triggers and the real chat tool, over one fake server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAutoSync,
  type KeyedSignal,
  type SyncWorker,
  type ToolDataTransport,
} from '@ueberblick/client';
import { parseMentions } from '@ueberblick/core/mentions';
import { createToolHost } from '@ueberblick/ui';
import { testMap, testPorts } from '@ueberblick/ui/tool-testing';
import { createChatTool } from '@ueberblick/tool-chat';
import {
  FakeToolServer,
  kit,
  type Kit,
} from '../../../../../../packages/client/src/tooldata/tooldata.testing';
import { createToolBadges, type ToolBadges } from './badges';
import { toolDataSource } from './device-data';
import { createChatLink } from './chat-link';

/** The fake server as one person sees it: whatever that person appends is theirs, with the mentions the server parses. */
const as = (server: FakeToolServer, who: string): ToolDataTransport => ({
  page: (t, a, l) => server.page(t, a, l),
  markRead: (t, m) => server.markRead(t, m),
  async append(t, b) {
    const record =
      server.stream(t).find((r) => r.id === b.id) ?? server.post(t, who, b.body, b.id, parseMentions(b.body));
    return { kind: 'ok', value: { outcome: 'accepted', record } };
  },
});

function bell(): KeyedSignal & { ring(key: string): void } {
  const fns = new Set<(k: string) => void>();
  return {
    subscribe: (fn) => (fns.add(fn), () => void fns.delete(fn)),
    ring: (k) => fns.forEach((f) => f(k)),
  };
}
const quiet = { subscribe: () => () => undefined };
const worker = { pull: async () => ({ pages: 0, reset: undefined, cursor: 0 }) } as unknown as SyncWorker;

interface Device {
  readonly kit: Kit;
  readonly bell: ReturnType<typeof bell>;
  readonly badges: ToolBadges;
}
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((s) => s());
  document.body.replaceChildren();
});

async function device(server: FakeToolServer, who: string): Promise<Device> {
  const doorbell = bell();
  const k = await kit({ transport: as(server, who), self: () => who, doorbell, readDelayMs: 0 });
  const auto = createAutoSync({
    worker,
    timers: k.timers,
    doorbell: quiet,
    online: quiet,
    visible: quiet,
    tools: k.data,
  });
  auto.start();
  const badges = createToolBadges({ data: k.data, keys: ['chat'], self: who });
  stops.push(() => (auto.stop(), badges.close(), k.data.close()));
  return { kit: k, bell: doorbell, badges };
}

async function open(d: Device, who: string, names: Record<string, string>) {
  const host = createToolHost({
    loaders: {
      chat: async () =>
        createChatTool({
          self: () => who,
          nameOf: (id) => names[id],
          people: () => Object.entries(names).map(([id, name]) => ({ id, name })),
          featureLabel: () => undefined,
          seed: createChatLink().seed,
        }),
    },
    ports: testPorts(),
    locale: 'de',
    data: toolDataSource(d.kit.data, () => true),
  });
  const root = document.createElement('div');
  document.body.append(root);
  await host.mountPanel(root, {
    toolKey: 'chat',
    point: 'tools-sheet',
    startTask: vi.fn(),
    map: testMap(),
    openFeature: vi.fn(),
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (k) => k,
  });
  return root;
}

describe('two devices', () => {
  it('A sends; B shows it after the doorbell, with a mention badge until B reads', async () => {
    const server = new FakeToolServer(['chat']);
    const a = await device(server, 'anna');
    const b = await device(server, 'bo');
    await Promise.all([a.kit.data.sync(), b.kit.data.sync()]);

    // A writes in their open panel
    const panelA = await open(a, 'anna', { anna: 'Anna', bo: 'Bo' });
    const box = panelA.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'Hallo @bo und #f1';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(a.kit.data.handle('chat').items()).toHaveLength(1));
    expect(panelA.textContent).toContain('Wird gesendet'); // in A's outbox
    await a.kit.data.drain(); // A's device sends (the app's `kick` does this at once)
    expect(server.stream('chat')).toHaveLength(1);
    await vi.waitFor(() => expect(panelA.textContent).not.toContain('Wird gesendet'));

    // B has not heard anything yet; the server rings the doorbell
    expect(b.kit.data.handle('chat').items()).toHaveLength(0);
    b.bell.ring('chat');
    b.kit.timers.fire(); // the debounce
    await vi.waitFor(() => expect(b.kit.data.handle('chat').items()).toHaveLength(1));
    expect(b.badges.current()).toEqual({ chat: { hard: 1, soft: true } });

    // B opens the panel: the message is there, the badge clears (reading by server seq), and the server hears it
    const panelB = await open(b, 'bo', { anna: 'Anna', bo: 'Bo' });
    await vi.waitFor(() => expect(panelB.textContent).toContain('Anna · '));
    expect(panelB.textContent).toContain('@Bo');
    await vi.waitFor(() => expect(b.badges.current()).toEqual({ chat: { hard: 0, soft: false } }));
    await vi.waitFor(() => {
      b.kit.timers.fire(); // the batched read mark goes out
      expect(server.reads.get('chat')?.lastReadSeq).toBe(1);
    });
    expect(server.lastMark?.mentionSeq).toBe(1);
  });

  it('a device that was offline catches up with everything that came meanwhile, in server order', async () => {
    const server = new FakeToolServer(['chat']);
    const a = await device(server, 'anna');
    const b = await device(server, 'bo');
    server.offline = true;
    await b.kit.data.sync().catch(() => undefined);
    server.offline = false;
    for (const body of ['eins', 'zwei', 'drei']) {
      await a.kit.data.handle('chat').append(body);
    }
    await a.kit.data.drain();
    b.bell.ring('chat');
    b.kit.timers.fire();
    await vi.waitFor(() => expect(b.kit.data.handle('chat').items()).toHaveLength(3));
    expect(
      b.kit.data
        .handle('chat')
        .items()
        .map((i) => i.body),
    ).toEqual(['eins', 'zwei', 'drei']);
  });
});
