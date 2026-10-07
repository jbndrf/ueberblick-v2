// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { overwriteGetLocale } from '../../../../../../../../../../packages/ui/src/paraglide/runtime.js';
import type * as Sonner from 'svelte-sonner';
import { ICON_BADGES, ICON_TEMPLATES, checkLook, droppedFor, templateIcon } from '@ueberblick/builder';
import IconsDialog from '../../../../../../../lib/admin/icons/IconsDialog.svelte';
import type { IconsApi } from '../../../../../../../lib/admin/icons/api';
import type { IconCall, IconResult, IconsKit, IconsState } from '../../../../../../../lib/admin/icons/types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

const STAGE = [
  { key: 'erfasst', label: 'Erfasst', stage: { start: true, end: false } },
  { key: 'massnahme', label: 'Maßnahme', stage: { start: false, end: false } },
  { key: 'erledigt', label: 'Erledigt', stage: { start: false, end: true } },
];
const SELECTS = [
  { key: 'stage', label: 'Status', optionKeys: ['erfasst', 'massnahme', 'erledigt'] },
  { key: 'vitalitaet', label: 'Vitalität', optionKeys: ['v0', 'v1'] },
];
const WITH_STAGE: IconsState = {
  type: 'baum',
  classify: { property: 'stage', values: { erfasst: { color: '#2b6cb0', icon: { key: 'check' } } } },
  marker: { color: '#2f855a', icon: { key: 'tree-deciduous' } },
  selects: SELECTS,
  options: STAGE,
  stage: 'stage',
};
const BARE: IconsState = {
  type: 'baum',
  classify: null,
  marker: null,
  selects: SELECTS,
  options: [],
  stage: 'stage',
};

const refused = (message: string): IconResult => ({ ok: false, message });
function fakeApi(next: (call: IconCall) => IconResult | Promise<IconResult>) {
  return { call: vi.fn((c: IconCall) => Promise.resolve(next(c))) } as unknown as IconsApi & {
    call: ReturnType<typeof vi.fn>;
  };
}

const kit: IconsKit = {
  templates: ICON_TEMPLATES,
  badges: ICON_BADGES,
  templateIcon,
  checkLook,
  droppedFor,
};

function mount(icons: IconsState, api: ReturnType<typeof fakeApi>) {
  const onchanged = vi.fn();
  const onstate = vi.fn();
  const view = render(IconsDialog, {
    open: true,
    locale: 'de',
    name: 'Baum',
    kit,
    icons,
    api,
    onchanged,
    onstate,
  });
  return { ...view, onchanged, onstate };
}
const dialog = () => screen.getByTestId('icons-dialog');

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

describe.each([
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
] as const)('Icons dialog at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  it('with no classifying property it shows the type icon only', () => {
    mount(
      BARE,
      fakeApi(() => refused('x')),
    );
    expect(within(dialog()).getByText('Objektart-Icons')).toBeTruthy();
    expect(within(dialog()).getByTestId('icons-marker')).toBeTruthy();
    expect(within(dialog()).queryByTestId('icons-values')).toBeNull();
    expect((within(dialog()).getByTestId('icons-property') as HTMLSelectElement).value).toBe('');
  });

  it('offers "keine" and the select properties of the type, the stage property included', () => {
    mount(
      BARE,
      fakeApi(() => refused('x')),
    );
    const options = [...(within(dialog()).getByTestId('icons-property') as HTMLSelectElement).options].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['keine', 'Status', 'Vitalität']);
  });

  it('picking the stage property is sent as one draft edit, and the new state is shown', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: WITH_STAGE }));
    const { onchanged, onstate } = mount(BARE, api);
    await user.selectOptions(within(dialog()).getByTestId('icons-property'), 'stage');
    await waitFor(() => expect(api.call).toHaveBeenCalledWith({ action: 'property', property: 'stage' }));
    expect(onstate).toHaveBeenCalledWith(WITH_STAGE);
    expect(onchanged).toHaveBeenCalled();
  });

  it('lists one row per option with its label and v3 stage badge, Set or Edit and Clear', () => {
    mount(
      WITH_STAGE,
      fakeApi(() => refused('x')),
    );
    const rows = within(dialog()).getByTestId('icons-values');
    const row = (v: string) => rows.querySelector(`[data-value="${v}"]`) as HTMLElement;
    expect(within(row('erfasst')).getByText('Erfasst')).toBeTruthy();
    expect(within(row('erfasst')).getByText('Start')).toBeTruthy();
    expect(within(row('massnahme')).getByText('Schritt')).toBeTruthy();
    expect(within(row('erledigt')).getByText('Ende')).toBeTruthy();
    expect(within(row('erfasst')).getByRole('button', { name: 'Bearbeiten' })).toBeTruthy();
    expect(within(row('erfasst')).getByRole('button', { name: 'Entfernen' })).toBeTruthy();
    expect(within(row('massnahme')).getByRole('button', { name: 'Festlegen' })).toBeTruthy();
    expect(within(row('massnahme')).queryByRole('button', { name: 'Entfernen' })).toBeNull();
  });

  it('sets a value icon from a template and a colour; the call carries colour and icon', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: WITH_STAGE }));
    const { onchanged } = mount(WITH_STAGE, api);
    const row = within(dialog())
      .getByTestId('icons-values')
      .querySelector('[data-value="massnahme"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Festlegen' }));
    expect(await screen.findByText('Icon-Designer')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Icon speichern' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(dialog().querySelector('[data-template="pin"]') as HTMLElement);
    expect(screen.getByTestId('icon-preview')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Icon speichern' }));
    await waitFor(() =>
      expect(api.call).toHaveBeenCalledWith({
        action: 'set_value',
        value: 'massnahme',
        look: { color: '#2563eb', icon: { key: 'map-pin' } },
      }),
    );
    expect(onchanged).toHaveBeenCalled();
    // back in the overview
    expect(await screen.findByTestId('icons-values')).toBeTruthy();
  });

  it('writes a template without a registry key as inline SVG, with the size', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: WITH_STAGE }));
    mount(BARE, api);
    await user.click(within(dialog()).getByRole('button', { name: 'Icon festlegen' }));
    await user.click(dialog().querySelector('[data-template="hexagon"]') as HTMLElement);
    const size = screen.getByLabelText('Größe (px)');
    await user.clear(size);
    await user.type(size, '48');
    await user.click(screen.getByRole('button', { name: 'Icon speichern' }));
    await waitFor(() => expect(api.call).toHaveBeenCalled());
    const call = api.call.mock.calls[0]?.[0] as Extract<IconCall, { action: 'set_marker' }>;
    expect(call.action).toBe('set_marker');
    expect(call.look.icon).toMatchObject({ size: 48 });
    expect(call.look.icon).toHaveProperty('svg');
  });

  it('refuses invalid pasted SVG in place and keeps Save disabled', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: WITH_STAGE }));
    mount(BARE, api);
    await user.click(within(dialog()).getByRole('button', { name: 'Icon festlegen' }));
    await user.click(screen.getByTestId('tab-custom'));
    await user.click(screen.getByTestId('svg-paste'));
    await user.paste('<svg onload="x()"><script></script></svg>');
    expect((await screen.findByTestId('svg-problem')).textContent).toContain('Ungültiges SVG');
    expect((screen.getByRole('button', { name: 'Icon speichern' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.call).not.toHaveBeenCalled();
  });

  it('accepts a valid pasted SVG and saves it as { svg }', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: WITH_STAGE }));
    mount(BARE, api);
    await user.click(within(dialog()).getByRole('button', { name: 'Icon festlegen' }));
    await user.click(screen.getByTestId('tab-custom'));
    await user.click(screen.getByTestId('svg-paste'));
    await user.paste('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>');
    await user.click(screen.getByRole('button', { name: 'Icon speichern' }));
    await waitFor(() => expect(api.call).toHaveBeenCalled());
    const call = api.call.mock.calls[0]?.[0] as Extract<IconCall, { action: 'set_marker' }>;
    expect(call.look.icon).toEqual({
      svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
    });
  });

  it('shows the refusal of a size outside 8 to 128 in the editor and stays there', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => refused('Die Größe muss eine ganze Zahl von 8 bis 128 sein'));
    mount(BARE, api);
    await user.click(within(dialog()).getByRole('button', { name: 'Icon festlegen' }));
    await user.click(dialog().querySelector('[data-template="circle"]') as HTMLElement);
    const size = screen.getByLabelText('Größe (px)');
    await user.clear(size);
    await user.type(size, '200');
    await user.click(screen.getByRole('button', { name: 'Icon speichern' }));
    expect((await screen.findByTestId('icon-refusal')).textContent).toContain('8 bis 128');
    expect(screen.getByText('Icon-Designer')).toBeTruthy();
  });

  it('Clear sends clear_value', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: BARE }));
    mount(WITH_STAGE, api);
    const row = within(dialog())
      .getByTestId('icons-values')
      .querySelector('[data-value="erfasst"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith({ action: 'clear_value', value: 'erfasst' }));
  });

  it('switching to a property that lacks the entries asks first; Abbrechen changes nothing, confirming drops', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: BARE }));
    mount(WITH_STAGE, api);
    await user.selectOptions(within(dialog()).getByTestId('icons-property'), 'vitalitaet');
    const ask = await screen.findByRole('alertdialog');
    expect(within(ask).getByText(/1 Einträge entfernt/)).toBeTruthy();
    expect(within(ask).getByText(/Erfasst/)).toBeTruthy();
    await user.click(within(ask).getByRole('button', { name: 'Abbrechen' }));
    expect(api.call).not.toHaveBeenCalled();
    expect((within(dialog()).getByTestId('icons-property') as HTMLSelectElement).value).toBe('stage');

    await user.selectOptions(within(dialog()).getByTestId('icons-property'), 'vitalitaet');
    await user.click(await screen.findByRole('button', { name: 'Wechseln und entfernen' }));
    await waitFor(() =>
      expect(api.call).toHaveBeenCalledWith({ action: 'property', property: 'vitalitaet' }),
    );
  });

  it('"keine" with entries asks first, then removes classify', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => ({ ok: true, state: BARE }));
    mount(WITH_STAGE, api);
    await user.selectOptions(within(dialog()).getByTestId('icons-property'), '');
    await user.click(await screen.findByRole('button', { name: 'Wechseln und entfernen' }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith({ action: 'property', property: null }));
  });

  it('a refusal of the server is shown in place', async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => refused('Die Änderung wurde abgelehnt'));
    const { onchanged } = mount(BARE, api);
    await user.selectOptions(within(dialog()).getByTestId('icons-property'), 'stage');
    expect((await screen.findByTestId('icons-refusal')).textContent).toBe('Die Änderung wurde abgelehnt');
    expect(onchanged).not.toHaveBeenCalled();
  });
});
