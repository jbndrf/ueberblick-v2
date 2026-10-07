// @vitest-environment jsdom
// The Projekt-Chat in the Werkzeuge slot (WP-684): v3's tile with its badge, the side panel that stays open beside the
// map and the feature sheet, and "Im Chat erwähnen" arriving from the feature sheet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import { createPrefsClient } from '@ueberblick/client';
import { fakeData, msg } from '../../../../../../../packages/tools/chat/src/chat.testing';
import type { Device } from '../../device';
import type { ShellContext } from '../../shell/sheets';
import { createChatLink } from '../../tools/chat-link';
import { toolEntries } from '../../tools/entries';
import { createToolPerson } from '../../tools/person';
import ToolsSlot from './ToolsSlot.svelte';

afterEach(cleanup);

const file = {
  roles: { kontrolle: { label: 'K', app: { tools: { chat: {} } } } },
  tools: { chat: {} },
} as never;

function setup(badge = { hard: 0, soft: false }) {
  const store = new Map<string, string>();
  const prefs = createPrefsClient({
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
    project: 'p',
    participant: 'u',
  });
  const data = fakeData([msg(1, 'anna', 'Schau #f1')]);
  const chat = createChatLink();
  const device = {
    project: 'p',
    roleKey: 'kontrolle',
    geo: createGeo(),
    blobs: { put: async () => undefined },
    config: { file, foldTypes: new Map() },
    problems: { list: () => [] },
    searchText: () => [],
    feature: (id: string) => ({ id, type: 'baum', properties: {} }),
    reader: { labelOf: () => 'Linde 7' },
    store: { personName: () => undefined },
    participant: { id: 'me', name: 'Mia' },
    toolBadges: { current: () => ({ chat: badge }), subscribe: () => () => undefined },
    toolData: { handle: () => Object.assign(data, { members: () => [{ id: 'anna', name: 'Anna' }] }) },
    toolSource: { forTool: () => data },
    chat,
  } as unknown as Device;
  const ctx = {
    device,
    locale: 'de',
    online: true,
    map: undefined,
    center: () => undefined,
    openFeature: vi.fn<(id: FeatureId) => void>(),
    openChat: vi.fn(),
    tools: {
      entries: toolEntries(file, 'kontrolle', {}),
      person: createToolPerson({ file, roleKey: 'kontrolle', prefs }),
    },
  } as unknown as ShellContext;
  return { ctx, chat, data };
}

describe('Projekt-Chat in Werkzeuge', () => {
  it('is a tile "Projekt-Chat" with the red mention count (99+ above 99), or the grey dot', async () => {
    render(ToolsSlot, { ctx: setup({ hard: 120, soft: true }).ctx, onclose: vi.fn() });
    const tile = screen.getByRole('button', { name: /Projekt-Chat/ });
    expect(tile.textContent).toContain('99+');
    cleanup();
    render(ToolsSlot, { ctx: setup({ hard: 0, soft: true }).ctx, onclose: vi.fn() });
    expect(screen.getByRole('img', { name: 'Ungelesen' })).toBeTruthy();
  });

  it('a tap on the tile closes the sheet and opens the chat, which is its own slot (v3 `onOpenChat`: `chatSheetOpen = true`)', async () => {
    const { ctx } = setup();
    const onclose = vi.fn();
    render(ToolsSlot, { ctx, onclose });
    await fireEvent.click(screen.getByRole('button', { name: /Projekt-Chat/ }));
    expect(ctx.openChat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onclose).toHaveBeenCalledTimes(1)); // Werkzeuge ends; the chat panel is the shell's
    expect(screen.queryByRole('dialog', { name: 'Projekt-Chat' })).toBeNull();
  });
});
