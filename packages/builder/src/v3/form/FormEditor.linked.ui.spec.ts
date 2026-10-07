// @vitest-environment jsdom
// WP-449 (owner answer A5, A-047): v3's "Verknüpftes Feld hinzufügen" in the form editor: the picker offers only the
// task's declared binds and the properties of the Objektart they yield, a pick adds the entry `<bind>.<property>`
// with an origin badge, and the field panel's switch writes the form entry's `readonly`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { messages } from '../../shell/messages';
import LinkedFieldPicker from './LinkedFieldPicker.svelte';
import { boundOf, splitBindKey } from './bound';
import { clean, openEditor, stubBrowser, TASK, TYPE } from './editor.testing';

beforeAll(stubBrowser);
const user = userEvent.setup({ pointerEventsCheck: 0 });
afterEach(cleanup);

async function pickFirst(): Promise<Awaited<ReturnType<typeof openEditor>>> {
  const h = await openEditor();
  await user.click(screen.getByTestId('linked-add'));
  await user.click(screen.getByTestId('linked-bind-area'));
  await user.click(screen.getByTestId('linked-field-name'));
  return h;
}

describe('boundOf', () => {
  it('lists the declared binds with the pickable properties of the Objektart they yield', () => {
    const targets = boundOf(clean().effective(), TASK, TYPE, 'de');
    expect(targets.map((x) => [x.name, x.type])).toEqual([['area', 'flaeche']]);
    // The geometry is a map matter and stays out; the others are offered.
    expect(targets[0]?.properties.map((p) => p.key)).toEqual(['name', 'letzte_kontrolle']);
  });

  it('a task without a bind has no targets; a key splits at the first dot', () => {
    expect(boundOf(clean().effective(), 'befund_ergaenzen', TYPE, 'de')).toEqual([]);
    expect(splitBindKey('area.name')).toEqual({ bind: 'area', property: 'name' });
    expect(splitBindKey('vitalitaet')).toBeUndefined();
  });
});

describe('Verknüpftes Feld hinzufügen', () => {
  it('lists only the bind, then only its Objektart’s properties; a pick adds <bind>.<property> with the origin badge', async () => {
    const h = await openEditor();
    await user.click(screen.getByTestId('linked-add'));
    const dialog = screen.getByTestId('linked-picker');
    expect(within(dialog).getAllByRole('button', { name: /area/ })).toHaveLength(1);
    await user.click(screen.getByTestId('linked-bind-area'));
    expect(screen.queryByTestId('linked-field-geometrie')).toBeNull();
    expect(screen.queryByTestId('linked-field-vitalitaet')).toBeNull();
    await user.click(screen.getByTestId('linked-field-name'));
    expect(Object.keys(h.last().effective().tasks?.[TASK]?.form ?? {}).at(-1)).toBe('area.name');
    const card = document.querySelector('[data-key="area.name"]') as HTMLElement;
    expect(within(card).getByTestId('field-origin').textContent).toContain('Fläche');
  });

  it('a field that is in the form is greyed in the picker', async () => {
    await pickFirst();
    await user.click(screen.getByTestId('linked-add'));
    await user.click(screen.getByTestId('linked-bind-area'));
    expect((screen.getByTestId('linked-field-name') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('linked-field-letzte_kontrolle') as HTMLButtonElement).disabled).toBe(false);
  });

  it('without any bind the picker says so (v3 "Keine Beziehungen")', () => {
    render(LinkedFieldPicker, { open: true, t: messages('de'), targets: [], onpick: () => {} });
    expect(screen.getByTestId('linked-none').textContent).toContain('verknüpft kein Objekt');
  });

  it('the field panel has the read-only switch: on writes readonly: true, off removes it (editable by default)', async () => {
    const h = await pickFirst();
    await user.click(document.querySelector('[data-key="area.name"]') as HTMLElement);
    expect(screen.getByTestId('linked-config')).toBeTruthy();
    const sw = screen.getByTestId('cfg-readonly');
    expect(h.entry('area.name')?.readonly).toBeUndefined();
    await user.click(sw);
    expect(h.entry('area.name')?.readonly).toBe(true);
    await user.click(screen.getByTestId('cfg-readonly'));
    expect(h.entry('area.name')?.readonly).toBeUndefined();
  });

  it('the field panel’s remove takes the entry out of the form and keeps the property', async () => {
    const h = await pickFirst();
    await user.click(document.querySelector('[data-key="area.name"]') as HTMLElement);
    await user.click(screen.getByTestId('cfg-remove'));
    expect(h.entry('area.name')).toBeUndefined();
    expect(h.last().effective().types?.['flaeche']?.properties['name']).toBeDefined();
  });
});

describe('WP-494 linked field texts', () => {
  it('the panel keeps Platzhalter (form entry) and Hilfetext (the Objektart property) of a linked field', async () => {
    const h = await pickFirst();
    await user.click(document.querySelector('[data-key="area.name"]') as HTMLElement);
    await user.type(screen.getByTestId('cfg-placeholder'), 'Name');
    await user.tab();
    expect(h.entry('area.name')?.placeholder).toEqual({ de: 'Name' });
    await user.type(screen.getByTestId('cfg-help'), 'Hilfe');
    await user.tab();
    expect(h.last().effective().types?.['flaeche']?.properties['name']?.description).toEqual({ de: 'Hilfe' });
  });
});
