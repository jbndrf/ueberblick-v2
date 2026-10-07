// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { compile, compilePerms, NO_ASSETS } from '@ueberblick/core';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerFieldPane } from './register';

// jsdom has no layout engine: stub what bits-ui probes at mount.
beforeAll(() => {
  class Noop {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver ??= Noop as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
});
afterEach(() => {
  cleanup();
  setWidth(1024);
});

function setWidth(px: number): void {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
}

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

async function openField(
  key: string,
  over: Record<string, unknown> = {},
  afterRender: () => void = () => {},
) {
  const registry = createBuilderRegistry();
  registerFieldPane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry, onchange, ...over });
  afterRender();
  await userEvent.click(document.querySelector(`[data-path="types.baum.properties.${key}"]`) as HTMLElement);
  const last = (): Doc => (onchange.mock.calls.at(-1)?.[0] as Doc) ?? clean();
  return { onchange, last, pane: () => screen.getByTestId('field-pane') };
}

describe('the Felddefinition opens for a selected property', () => {
  it('shows label, key, type, required, the roles and the delete, with v3 labels', async () => {
    const { pane } = await openField('vitalitaet');
    const p = within(pane());
    expect((p.getByTestId('field-label') as HTMLInputElement).value).toBe('Vitalität (Roloff)');
    expect(p.getByTestId('field-key').textContent).toBe('vitalitaet');
    expect((p.getByTestId('field-type') as HTMLSelectElement).value).toBe('select');
    expect(p.getByText('Sichtbar für Rollen')).toBeTruthy();
    expect(p.getByText('Bearbeitbar für Rollen')).toBeTruthy();
    expect(p.getByRole('button', { name: 'Schlüssel kopieren' })).toBeTruthy();
    // vitalitaet comes from the template: the entry hides it (WP-490).
    expect(p.getByRole('button', { name: 'Ausblenden' })).toBeTruthy();
    expect(p.getByText(/Gilt überall, wo das Feld verwendet wird/)).toBeTruthy();
  });

  it('has no options editor for a text property', async () => {
    const { pane } = await openField('befund');
    expect(within(pane()).queryByTestId('field-options')).toBeNull();
  });
});

describe('editing label, required and options changes the Doc and compile stays clean (acceptance 1)', () => {
  it('label and required', async () => {
    const { last, pane } = await openField('hoehe_m');
    const input = within(pane()).getByTestId('field-label') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Kronenhöhe');
    await userEvent.tab();
    expect(last().effective().types?.['baum']?.properties['hoehe_m']?.label).toMatchObject({
      de: 'Kronenhöhe',
    });
    await userEvent.click(within(pane()).getByRole('switch', { name: 'Pflichtfeld' }));
    expect(last().effective().types?.['baum']?.properties['hoehe_m']?.required).toBe(true);
    expect(last().problems()).toEqual(clean().problems());
  });

  it('a new option is added with a key from its label', async () => {
    const { last, pane } = await openField('vitalitaet');
    await userEvent.type(within(pane()).getByTestId('field-option-new'), 'Abgestorben{Enter}');
    const options = last().effective().types?.['baum']?.properties['vitalitaet']?.options;
    expect(Object.keys(options ?? {}).at(-1)).toBe('abgestorben');
    expect(last().problems()).toEqual(clean().problems());
  });

  it('renaming an option changes the label only; the key stays (acceptance 3)', async () => {
    const { last, pane } = await openField('vitalitaet');
    const row = pane().querySelector('[data-option="v2"]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: '2 umbenennen' }));
    const input = within(row).getAllByRole('textbox')[0] as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'zwei{Enter}');
    const options = last().effective().types?.['baum']?.properties['vitalitaet']?.options as Record<
      string,
      unknown
    >;
    expect(Object.keys(options)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']);
    expect(options['v2']).toMatchObject({ de: 'zwei' });
  });

  it('moving an option up reorders; the ends are disabled', async () => {
    const { last, pane } = await openField('vitalitaet');
    const first = pane().querySelector('[data-option="v0"]') as HTMLElement;
    expect(
      (within(first).getByRole('button', { name: '0 nach oben verschieben' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const third = pane().querySelector('[data-option="v2"]') as HTMLElement;
    await userEvent.click(within(third).getByRole('button', { name: '2 nach oben verschieben' }));
    const options = last().effective().types?.['baum']?.properties['vitalitaet']?.options as Record<
      string,
      unknown
    >;
    expect(Object.keys(options)).toEqual(['v0', 'v2', 'v1', 'v3', 'v4']);
  });

  it("removing an option shows v3's hint about existing values", async () => {
    const { last, pane } = await openField('vitalitaet');
    const row = pane().querySelector('[data-option="v4"]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: '4 entfernen' }));
    expect(
      Object.keys(last().effective().types?.['baum']?.properties['vitalitaet']?.options ?? {}),
    ).not.toContain('v4');
    expect(screen.getByTestId('option-removed').textContent).toContain('verschieben nach');
  });

  it('changing the type to Text drops the options and keeps label and key', async () => {
    const { last, pane } = await openField('vitalitaet');
    await userEvent.selectOptions(within(pane()).getByTestId('field-type'), 'text');
    const p = last().effective().types?.['baum']?.properties['vitalitaet'];
    expect(p?.type).toBe('text');
    expect(p?.label).toBeDefined();
    expect(within(pane()).queryByTestId('field-options')).toBeNull();
  });
});

describe('Sichtbar für / Bearbeitbar für write the permissions (acceptance 2)', () => {
  it('Sichtbar für = [kontrolle] writes permissions.see.<p> and hides it from other roles', async () => {
    const { last, pane } = await openField('hoehe_m');
    const see = within(within(pane()).getByTestId('field-see'));
    await userEvent.click(see.getAllByRole('button')[0] as HTMLButtonElement);
    await userEvent.click(screen.getByRole('option', { name: /Baumkontrolle/ }));
    const file = last().effective();
    expect(file.types?.['baum']?.permissions?.see).toMatchObject({ hoehe_m: ['kontrolle'] });
    const c = compile(file, { assets: NO_ASSETS });
    if (!c.ok) throw new Error('draft does not compile');
    const perms = compilePerms(c.config).forType('baum' as never);
    expect(perms?.readable(['role:kontrolle']).has('hoehe_m')).toBe(true);
    expect(perms?.readable(['role:bauhof']).has('hoehe_m')).toBe(false);
  });

  it('Bearbeitbar für: picking a role writes the list, clearing writes $all', async () => {
    const { last, pane } = await openField('hoehe_m');
    const write = within(within(pane()).getByTestId('field-write'));
    await userEvent.click(write.getAllByRole('button')[0] as HTMLButtonElement);
    await userEvent.click(screen.getByRole('option', { name: /Bauhof/ }));
    expect(last().effective().types?.['baum']?.permissions?.write).toMatchObject({
      hoehe_m: ['kontrolle', 'bauhof'],
    });
    // remove both badges with Backspace in the search field
    await userEvent.click(screen.getByRole('textbox', { name: 'Suchen …' }));
    await userEvent.keyboard('{Backspace}{Backspace}');
    expect(last().effective().types?.['baum']?.permissions?.write).toMatchObject({ hoehe_m: '$all' });
  });

  it('shows what the file says: the roles that already edit it', async () => {
    const { pane } = await openField('hoehe_m');
    const write = within(pane()).getByTestId('field-write');
    expect(within(write).getAllByRole('button')[0]?.textContent).toContain('Baumkontrolle');
  });

  it('a property nobody may write says "Niemand", never "Alle Rollen"', async () => {
    const { pane } = await openField('patenschaft');
    const write = within(pane()).getByTestId('field-write');
    expect(within(write).getAllByRole('button')[0]?.textContent).toContain('Niemand');
  });

  it('inline role creation adds the role to the draft and picks it, saying it applies after going live', async () => {
    const { last, pane } = await openField('hoehe_m');
    const write = within(within(pane()).getByTestId('field-write'));
    await userEvent.click(write.getAllByRole('button')[0] as HTMLButtonElement);
    await userEvent.type(screen.getByRole('textbox', { name: 'Suchen …' }), 'Gutachter{Enter}');
    const file = last().effective();
    expect(file.roles?.['gutachter']).toBeDefined();
    expect(file.types?.['baum']?.permissions?.write).toMatchObject({ hoehe_m: ['kontrolle', 'gutachter'] });
    expect(screen.getByText(/gilt erst nach/)).toBeTruthy();
  });
});

describe("phone: v3's full-screen select dialog", () => {
  it('opens as a dialog with a Fertig button and picks a role', async () => {
    // The builder frame stays at its desktop layout; the picker reads the width when it draws (no resize event).
    const { last, pane } = await openField('hoehe_m', {}, () =>
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true }),
    );
    const see = within(within(pane()).getByTestId('field-see'));
    await userEvent.click(see.getAllByRole('button')[0] as HTMLButtonElement);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Baumkontrolle/ }));
    expect(within(dialog).getByRole('button', { name: 'Fertig (1)' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fertig (1)' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(last().effective().types?.['baum']?.permissions?.see).toMatchObject({ hoehe_m: ['kontrolle'] });
  });
});

describe('a see that is one audience for the row cannot be restricted from a property', () => {
  it('disables Sichtbar für and says where to change it', async () => {
    const template = musterstadt.templateSrc.replace(/ {2}baum:\n/, '  baum:\n');
    expect(template).toContain('baum:');
    const doc = clean().apply({ kind: 'set', path: 'types.baum.permissions.see', value: ['kontrolle'] }).doc;
    const { pane } = await openField('hoehe_m', { doc });
    const see = within(pane()).getByTestId('field-see');
    expect((within(see).getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(see.textContent).toContain('Berechtigungen');
  });
});

describe('Feld vollständig löschen', () => {
  // A field only this project has: it is deleted, not hidden.
  const own = (): Doc =>
    clean().apply({
      kind: 'set',
      path: 'types.baum.properties.eigen',
      value: { type: 'text', label: { de: 'Eigen' } },
    }).doc;

  it('asks first with the impact; Abbrechen keeps the field', async () => {
    const { pane, onchange } = await openField('eigen', { doc: own() });
    await userEvent.click(within(pane()).getByRole('button', { name: 'Feld vollständig löschen' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Feld „Eigen“ löschen?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onchange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Löschen removes an own property and clears the pane', async () => {
    const { pane, last } = await openField('eigen', { doc: own() });
    await userEvent.click(within(pane()).getByRole('button', { name: 'Feld vollständig löschen' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }));
    expect(last().effective().types?.['baum']?.properties['eigen']).toBeUndefined();
    expect(screen.queryByTestId('field-pane')).toBeNull();
  });

  it('a template field says Ausblenden (button, question, confirm) and is hidden with its form entries', async () => {
    const { pane, last } = await openField('befund');
    expect(within(pane()).queryByRole('button', { name: 'Feld vollständig löschen' })).toBeNull();
    await userEvent.click(within(pane()).getByRole('button', { name: 'Ausblenden' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Feld „Befund“ ausblenden?');
    expect(within(dialog).queryByRole('button', { name: 'Löschen' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausblenden' }));
    const file = last().effective();
    expect(file.types?.['baum']?.properties['befund']).toBeUndefined();
    expect(Object.keys(file.tasks?.['kontrolle']?.form ?? {})).not.toContain('befund');
    expect(screen.queryByTestId('field-pane')).toBeNull();
  });

  it('the property that carries the process cannot be deleted', async () => {
    const { pane } = await openField('stage');
    expect(within(pane()).queryByRole('button', { name: 'Feld vollständig löschen' })).toBeNull();
    expect(pane().textContent).toContain('trägt den Ablauf');
  });
});

describe('Schlüssel kopieren', () => {
  it('copies the key to the clipboard and says so', async () => {
    const user = userEvent.setup();
    const { pane } = await openField('vitalitaet');
    await user.click(within(pane()).getByRole('button', { name: 'Schlüssel kopieren' }));
    expect(await navigator.clipboard.readText()).toBe('vitalitaet');
    expect(within(pane()).getByText('Schlüssel kopiert')).toBeTruthy();
  });
});

describe("'In Daten-Tabs ausgeblendet' (v3 FieldDefinitionEditor, WP-444)", () => {
  it('writes and reads display.hidden', async () => {
    const { last, pane } = await openField('befund');
    const box = () =>
      within(pane()).getByRole('checkbox', { name: 'In Daten-Tabs ausgeblendet' }) as HTMLInputElement;
    expect(box().checked).toBe(false);
    await userEvent.click(box());
    expect(last().effective().types?.['baum']?.properties['befund']?.display?.hidden).toBe(true);
    expect(box().checked).toBe(true);
    await userEvent.click(box());
    expect(last().effective().types?.['baum']?.properties['befund']?.display?.hidden).toBeUndefined();
    expect(last().problems()).toEqual(clean().problems());
  });
});
