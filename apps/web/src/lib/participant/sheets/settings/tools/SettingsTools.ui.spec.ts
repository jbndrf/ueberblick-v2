// @vitest-environment jsdom
// The journey of the tool switches in Einstellungen -> Optionen (v3 SettingsSheet:561 with AdvancedFeaturesPanel):
// open Optionen, open the box, switch an offered tool on; the record of the person holds the switch (offline too).
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { createPrefsClient } from '@ueberblick/client';
import type { TemplateFile } from '@ueberblick/core/model';
import type { Device } from '../../../device';
import SettingsSlot from '../../../shell/SettingsSlot.svelte';
import type { ShellContext } from '../../../shell/sheets';
import { fakeOffline } from '../../../offline/fake.testing';
import { toolEntries } from '../../../tools/entries';
import { createToolPerson } from '../../../tools/person';
import { fakeDevice, memoryStorage } from '../fake-device.testing';
import { createDevicePrefs } from '../prefs';

afterEach(cleanup);

const file = {
  roles: { kontrolle: { label: 'K', app: { tools: { measure: { availability: 'offered' }, search: {} } } } },
  tools: { measure: {}, search: {} },
  tasks: {},
} as unknown as TemplateFile;

function mount() {
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
    participant: 'anna',
  });
  const flush = vi.fn();
  const person = createToolPerson({ file, roleKey: 'kontrolle', prefs, flush });
  const { device } = fakeDevice([]);
  const ctx = {
    device: { ...device, config: { file } } as unknown as Device,
    locale: 'en',
    online: true,
    openFeature: vi.fn(),
    tools: { entries: toolEntries(file, 'kontrolle', person.switches()), person },
    prefs: createDevicePrefs({ storage: memoryStorage(), prefersDark: () => false, deviceLocale: 'de' }),
    setLocale: vi.fn(),
    signOut: vi.fn(async () => true),
    offline: fakeOffline().context,
  } as unknown as ShellContext;
  render(SettingsSlot, { ctx, onclose: vi.fn() });
  return { prefs, flush };
}

describe('tool switches in Einstellungen', () => {
  it('Optionen shows the box with the count of tools that are on; an offered tool starts off, an active one on', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Options' }));
    const head = screen.getByRole('button', { name: /Advanced features/ });
    expect(head.textContent).toContain('1');
    await user.click(head);
    expect(screen.getByRole('switch', { name: 'Measure' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Search' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switching a tool is stored in the person record and sent', async () => {
    const { prefs, flush } = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Options' }));
    await user.click(screen.getByRole('button', { name: /Advanced features/ }));
    await user.click(screen.getByRole('switch', { name: 'Measure' }));
    expect(prefs.current().tools).toEqual({ measure: true });
    expect(flush).toHaveBeenCalled();
  });
});
