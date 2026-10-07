import { createPrefsClient } from '@ueberblick/client';
import type { Device } from '../device';
import { createChatLink } from '../tools/chat-link';
import type { SheetLoader, SheetSlot } from './sheets';
import StubSheet from './testing/StubSheet.svelte';

// Shared by the MapScreen specs: a device double, the screen props, an in-memory preference record.
const quiet = () => () => undefined;
export function deviceOf(
  tools: Record<string, unknown> = {},
  roleTools?: Record<string, unknown>,
  badges: Record<string, { hard: number; soft: boolean }> = {},
): Device {
  return {
    toolBadges: { current: () => badges, subscribe: quiet },
    network: { current: () => true, subscribe: quiet },
    chat: createChatLink(),
    project: 'baeume',
    participant: { id: 'berta' },
    clock: { now: () => new Date().toISOString() },
    identity: { project: { key: 'baeume', displayName: 'Bäume', icon: null, preview: false } },
    roleKey: 'kontrolle',
    actor: { id: 'u1', kind: 'participant', roles: ['kontrolle'] },
    get classified() {
      return (this as { config: never }).config;
    },
    config: {
      file: {
        types: { baum: { properties: {} } },
        views: {
          karte: {
            source: { type: 'baum' },
            layers: { l: { renderer: 'maplibre-2d', style: { layers: [] } } },
          },
        },
        tools,
        ...(roleTools === undefined
          ? {}
          : { roles: { kontrolle: { label: 'K', app: { tools: roleTools } } } }),
      },
    },
    queue: { status: () => ({ pending: 0, refused: [], review: [] }), subscribe: quiet },
    sync: { worker: { status: () => ({ phase: 'idle', featuresLoaded: 0 }), subscribe: quiet } },
    problems: { list: () => [], subscribe: quiet, report: () => undefined },
    reader: { startableTasks: () => [] },
    viewSource: () => ({ query: () => [], subscribe: quiet }),
    viewList: () => ({ rows: () => [], rename: (rows: readonly unknown[]) => rows }),
    changed: { subscribe: quiet },
  } as unknown as Device;
}

const stub: SheetLoader = () => Promise.resolve({ default: StubSheet });
export const registryOf =
  (...slots: SheetSlot[]) =>
  (slot: SheetSlot) =>
    slots.includes(slot) ? stub : undefined;

/** A preference record that stays in memory and never reaches a server: the person's tool switches. */
export const memoryPrefs = () => {
  const store = new Map<string, string>();
  return createPrefsClient({
    storage: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => void store.set(k, v),
      remove: (k) => void store.delete(k),
    },
    transport: {
      fetch: () => Promise.reject(new Error('offline')),
      send: () => Promise.reject(new Error('offline')),
    },
    clock: { now: () => new Date().toISOString() },
    project: 'baeume',
    participant: 'berta',
  });
};

export const props = (over: Record<string, unknown> = {}) => ({
  device: deviceOf(),
  toolPrefs: memoryPrefs(),
  locale: 'de' as const,
  onsignout: async () => true,
  onlocale: () => undefined,
  registry: registryOf(),
  ...over,
});
