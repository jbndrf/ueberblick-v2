// @vitest-environment jsdom
// The Projekt-Chat panel (v3 ChatSheet.svelte:405-458) at phone and desktop size: a non-modal side panel, the header
// "Projekt-Chat" with "Schließen", the visualViewport height, the thread and the composer of the tool, and the
// text for a role without the chat. The panel mounts the real tool over a fake device.
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { FeatureId } from '@ueberblick/core/model';
import { createGeo } from '@ueberblick/core/geo';
import { fakeData, msg } from '../../../../../../packages/tools/chat/src/chat.testing';
import type { Device } from '../device';
import ToolPanel from '../ToolPanel.svelte';
import { createChatLink } from './chat-link';

const axeViolations = async (el: Element): Promise<string[]> =>
  (await axe.run(el, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
    (v) => `${v.id}: ${v.help}`,
  );

function device(data: ReturnType<typeof fakeData> | undefined) {
  return {
    geo: createGeo(),
    blobs: { put: async () => undefined },
    config: { file: { tools: { chat: {} } }, foldTypes: new Map() },
    searchText: () => [],
    feature: (id: string) => (id === 'f1' ? { id, type: 'baum', properties: {} } : undefined),
    reader: { labelOf: () => 'Linde 7' },
    store: { personName: (id: string) => (id === 'anna' ? 'Anna' : undefined) },
    participant: { id: 'me', name: 'Mia' },
    toolData: { handle: () => Object.assign(data ?? {}, { members: () => [{ id: 'anna', name: 'Anna' }] }) },
    toolSource: { forTool: () => data },
    chat: createChatLink(),
  } as unknown as Device;
}

const map = { onTap: () => () => undefined } as never;

function open(data: ReturnType<typeof fakeData> | undefined, over: Record<string, unknown> = {}) {
  const props = {
    device: device(data),
    toolKey: 'chat',
    label: 'Projekt-Chat',
    locale: 'de' as const,
    map,
    onstartTask: vi.fn(),
    onopenFeature: vi.fn<(id: FeatureId) => void>(),
    onclose: vi.fn(),
    ...over,
  };
  return { props, ...render(ToolPanel, props) };
}

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
});

describe('panel (v3 ChatSheet.svelte:411-441)', () => {
  it('is a non-modal dialog named "Projekt-Chat" on the right: w-full, w-96 from md, no backdrop', async () => {
    open(fakeData());
    const panel = await screen.findByRole('dialog', { name: 'Projekt-Chat' });
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(panel.className).toContain('fixed');
    expect(panel.className).toContain('right-0');
    expect(panel.className).toContain('w-full');
    expect(panel.className).toContain('md:w-96');
    expect(document.querySelector('[data-slot="sheet-overlay"], [data-testid="sheet-backdrop"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Projekt-Chat' })).toBeTruthy();
  });

  it('closes with the button labelled "Schließen" (v3 had an English "Close") and with Escape', async () => {
    const { props } = open(fakeData());
    await fireEvent.click(await screen.findByRole('button', { name: 'Schließen' }));
    expect(props.onclose).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onclose).toHaveBeenCalledTimes(2);
  });

  it('is as high as the visible viewport, and follows it when the keyboard opens (v3 :344-357)', async () => {
    const listeners = new Set<() => void>();
    const vv = {
      height: 600,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    open(fakeData());
    const panel = await screen.findByRole('dialog');
    expect(panel.style.height).toBe('600px');
    vv.height = 320;
    listeners.forEach((f) => f());
    await waitFor(() => expect(panel.style.height).toBe('320px'));
  });

  it('shows the thread and the composer of the tool, and a # chip opens the feature without closing the panel', async () => {
    const { props } = open(fakeData([msg(1, 'anna', 'Schau #f1')]));
    expect(await screen.findByText('Schau')).toBeTruthy();
    expect(screen.getByPlaceholderText('Nachricht…')).toBeTruthy();
    expect(screen.getByText(/^Anna · /)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '#Linde 7' }));
    expect(props.onopenFeature).toHaveBeenCalledWith('f1');
    expect(props.onclose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('"Im Chat erwähnen" seeds the composer of the open panel without sending', async () => {
    const data = fakeData();
    const { props } = open(data);
    const box = (await screen.findByPlaceholderText('Nachricht…')) as HTMLTextAreaElement;
    (props.device as Device).chat.mention('f9');
    await waitFor(() => expect(box.value).toBe('#f9 '));
    expect(data.append).not.toHaveBeenCalled();
  });

  it('says "Der Projekt-Chat ist für deine Rolle nicht verfügbar." for a role that has no stream', async () => {
    open(undefined);
    expect(await screen.findByText('Der Projekt-Chat ist für deine Rolle nicht verfügbar.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Nachricht…')).toBeNull();
  });

  it('speaks English', async () => {
    open(fakeData(), { locale: 'en', label: 'Project chat' });
    expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy();
    expect(await screen.findByText('No messages yet. Be the first to say hi.')).toBeTruthy();
  });
});

describe.each([
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
])('at $width x $height', ({ width, height }) => {
  it('has no accessibility violations (with messages, and without the stream)', async () => {
    window.innerWidth = width;
    window.innerHeight = height;
    const view = open(fakeData([msg(1, 'anna', 'Hi @me, schau #f1'), msg(2, 'me', 'ok', { seq: null })]));
    await screen.findByText(/Hi/);
    expect(await axeViolations(document.body)).toEqual([]);
    view.unmount();
    document.body.replaceChildren();
    open(undefined);
    await screen.findByText('Der Projekt-Chat ist für deine Rolle nicht verfügbar.');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
