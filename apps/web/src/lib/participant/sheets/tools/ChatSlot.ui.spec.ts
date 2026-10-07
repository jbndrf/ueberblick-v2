// @vitest-environment jsdom
// The chat slot (WP-684): v3's `ChatSheet` with its own open flag. It stays open under Layer, Filter and Einstellungen
// (the shell does not close it, `panels.spec.ts`), a # chip opens the feature beside it, "Im Chat erwähnen" seeds it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import { fakeData, msg } from '../../../../../../../packages/tools/chat/src/chat.testing';
import type { Device } from '../../device';
import type { ShellContext } from '../../shell/sheets';
import { createChatLink } from '../../tools/chat-link';
import ChatSlot from './ChatSlot.svelte';

afterEach(cleanup);

const file = {
  roles: { kontrolle: { label: 'K', app: { tools: { chat: {} } } } },
  tools: { chat: {} },
} as never;

function setup() {
  const data = fakeData([msg(1, 'anna', 'Schau #f1')]);
  const chat = createChatLink();
  const device = {
    project: 'p',
    roleKey: 'kontrolle',
    geo: createGeo(),
    blobs: { put: async () => undefined },
    config: { file, foldTypes: new Map() },
    searchText: () => [],
    feature: (id: string) => ({ id, type: 'baum', properties: {} }),
    reader: { labelOf: () => 'Linde 7' },
    store: { personName: () => undefined },
    participant: { id: 'me', name: 'Mia' },
    toolData: {
      handle: () =>
        Object.assign(data, {
          members: () => [
            { id: 'zoe', name: 'Zoe' },
            { id: 'anna', name: 'Anna' },
          ],
        }),
    },
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
  } as unknown as ShellContext;
  return { ctx, chat };
}

describe('the chat slot', () => {
  it('shows the non-modal chat panel', async () => {
    render(ChatSlot, { ctx: setup().ctx, onclose: vi.fn() });
    const panel = await screen.findByRole('dialog', { name: 'Projekt-Chat' });
    expect(panel.getAttribute('aria-modal')).toBe('false');
  });

  it('a # chip opens the feature and the chat stays open (v3: instance-reference-open did not close it)', async () => {
    const { ctx } = setup();
    const onclose = vi.fn();
    render(ChatSlot, { ctx, onclose });
    await fireEvent.click(await screen.findByRole('button', { name: '#Linde 7' }));
    expect(ctx.openFeature).toHaveBeenCalledWith('f1');
    expect(onclose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Projekt-Chat' })).toBeTruthy();
  });

  it('the person picker lists every member the device holds, also one who never wrote (v3 mentionable-participants)', async () => {
    render(ChatSlot, { ctx: setup().ctx, onclose: vi.fn() });
    const picker = await screen.findByRole('combobox', { name: /Jemanden erwähnen/ });
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Jemanden erwähnen',
      'Anna',
      'Zoe',
    ]);
  });

  it('closing the panel closes the slot', async () => {
    const onclose = vi.fn();
    render(ChatSlot, { ctx: setup().ctx, onclose });
    await fireEvent.click(await screen.findByRole('button', { name: 'Schließen' }));
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('"Im Chat erwähnen" before the slot mounted seeds the composer, and the request is used up', async () => {
    const { ctx, chat } = setup();
    chat.mention('f9');
    render(ChatSlot, { ctx, onclose: vi.fn() });
    const box = (await screen.findByPlaceholderText('Nachricht…')) as HTMLTextAreaElement;
    expect(box.value).toBe('#f9 ');
    expect(chat.takeOpenRequest()).toBe(false);
  });

  it('"Im Chat erwähnen" while the chat is open seeds it too and clears the request', async () => {
    const { ctx, chat } = setup();
    render(ChatSlot, { ctx, onclose: vi.fn() });
    await screen.findByPlaceholderText('Nachricht…');
    chat.mention('f9');
    expect(((await screen.findByPlaceholderText('Nachricht…')) as HTMLTextAreaElement).value).toBe('#f9 ');
    expect(chat.takeOpenRequest()).toBe(false);
  });
});
