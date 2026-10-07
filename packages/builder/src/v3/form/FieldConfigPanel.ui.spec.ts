// @vitest-environment jsdom
// WP-381: v3's FieldConfigPanel for a field selected in the form editor, one test per acceptance box and per element:
// each Darstellung control round-trips through the file (Doc), the Felddefinition is WP-337's pane, an invalid
// expression shows its problem in place. The width and the drag are WP-380; Berechnet and the type settings are in
// `field/TypeSettings.ui.spec.ts`.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../task/shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { registerFieldPane } from '../field/register';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { formOf } from './model';
import { registerFormEditor } from './register';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(cleanup);

const T = 'kontrolle';
const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const reloaded = (doc: Doc): Doc => openProject(musterstadt.templateSrc, doc.save().overlaySrc);

/** The form editor of `kontrolle` with `key` selected. */
async function openPanel(key: string, doc: Doc = clean(), pick = 'card') {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerFieldPane(registry);
  registerFormEditor(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  await userEvent.click(document.querySelector(`[data-path="tasks.${T}"]`) as HTMLElement);
  await userEvent.click(screen.getByRole('tab', { name: 'Formular' }));
  await userEvent.click(screen.getByTestId('step-0-edit'));
  if (pick === 'library') await userEvent.click(screen.getByTestId(`library-${key}`));
  await userEvent.click(document.querySelector(`[data-key="${key}"]`) as HTMLElement);
  const last = (): Doc => (onchange.mock.calls.at(-1)?.[0] as Doc) ?? doc;
  const entry = () => formOf(last().effective(), T)[key];
  const prop = () => last().effective().types?.['baum']?.properties[key];
  return { last, entry, prop, onchange, panel: () => screen.getByTestId('field-config') };
}

const typeInto = async (el: HTMLElement, text: string): Promise<void> => {
  await userEvent.clear(el);
  if (text !== '') await userEvent.type(el, text);
  await userEvent.tab();
};

describe('the panel opens for a selected field', () => {
  it('shows the type badge and label, the name, Darstellung and the link to the Felddefinition', async () => {
    const h = await openPanel('befund');
    const p = within(h.panel());
    expect(p.getByTestId('cfg-type').textContent).toBe('Text');
    expect(p.getByText('Befund')).toBeTruthy();
    expect(p.getByRole('heading', { name: 'Darstellung in diesem Formular' })).toBeTruthy();
    expect(p.getByText('Gilt nur für dieses Formular.')).toBeTruthy();
    expect(p.getByTestId('cfg-edit-definition').textContent).toContain('Felddefinition bearbeiten');
    expect(p.getByTestId('cfg-remove').textContent).toContain('Aus Formular entfernen');
  });

  it("the Felddefinition is WP-337's pane, not a copy: it opens inside the editor and writes the same property", async () => {
    const h = await openPanel('befund');
    await userEvent.click(screen.getByTestId('cfg-edit-definition'));
    const pane = screen.getByTestId('field-pane');
    expect(pane.getAttribute('data-path')).toBe('types.baum.properties.befund');
    expect(within(pane).getByTestId('field-label')).toBeTruthy();
    await userEvent.click(within(pane).getByTestId('field-required'));
    expect(h.prop()?.required).toBe(true);
  });

  it('"Aus Formular entfernen" takes the field out of the form and keeps the property', async () => {
    const h = await openPanel('foto');
    await userEvent.click(screen.getByTestId('cfg-remove'));
    expect(formOf(h.last().effective(), T)['foto']).toBeUndefined();
    expect(h.prop()).toBeDefined();
    expect(screen.getByTestId('form-preview')).toBeTruthy();
  });
});

describe('Darstellung round-trips through the file', () => {
  it('placeholder', async () => {
    const h = await openPanel('befund');
    await typeInto(screen.getByTestId('cfg-placeholder'), 'z. B. Pilzbefall');
    expect(h.entry()?.placeholder).toEqual({ de: 'z. B. Pilzbefall' });
    expect(formOf(reloaded(h.last()).effective(), T)['befund']?.placeholder).toEqual({
      de: 'z. B. Pilzbefall',
    });
    await typeInto(screen.getByTestId('cfg-placeholder'), '');
    expect(h.entry()?.placeholder).toBeUndefined();
  });

  it('help text is the description of the property, and says it applies in every form', async () => {
    const h = await openPanel('befund');
    await typeInto(screen.getByTestId('cfg-help'), 'Was fällt auf?');
    expect(h.prop()?.description).toEqual({ de: 'Was fällt auf?' });
    expect(screen.getByText('Gilt in jedem Formular, das dieses Feld hat.')).toBeTruthy();
  });

  it('required: the switch writes the form entry; a property that is required itself cannot be relaxed here', async () => {
    const h = await openPanel('hoehe_m');
    await userEvent.click(screen.getByTestId('cfg-required'));
    expect(h.entry()?.required).toBe(true);
    await userEvent.click(screen.getByTestId('cfg-required'));
    expect(h.entry()?.required).toBeUndefined();
    cleanup();
    const doc = clean();
    const required = doc.apply({
      kind: 'set',
      path: 'types.baum.properties.hoehe_m.required',
      value: true,
    }).doc;
    await openPanel('hoehe_m', required);
    expect((screen.getByTestId('cfg-required') as HTMLElement).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('cfg-required').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/In der Felddefinition als Pflichtfeld/)).toBeTruthy();
  });

  it('prefill: constant, last value, expression; empty removes it', async () => {
    const h = await openPanel('befund');
    const select = screen.getByTestId('cfg-prefill');
    await userEvent.selectOptions(select, 'constant');
    await typeInto(screen.getByTestId('cfg-prefill-constant'), 'in Ordnung');
    expect(h.entry()?.calculate).toBe("'in Ordnung'");
    await userEvent.selectOptions(select, 'last_value');
    expect(h.entry()?.calculate).toBe('self.befund');
    await userEvent.selectOptions(select, 'computed');
    await typeInto(screen.getByTestId('cfg-prefill-expression'), 'self.befund.upper()');
    expect(h.entry()?.calculate).toBe('self.befund.upper()');
    expect(formOf(reloaded(h.last()).effective(), T)['befund']?.calculate).toBe('self.befund.upper()');
    await userEvent.selectOptions(select, 'empty');
    expect(h.entry()?.calculate).toBeUndefined();
  });

  it('an invalid prefill expression shows the problem and is not written', async () => {
    const h = await openPanel('foto');
    await userEvent.selectOptions(screen.getByTestId('cfg-prefill'), 'computed');
    await typeInto(screen.getByTestId('cfg-prefill-expression'), 'self.gibt_es_nicht +');
    expect(screen.getByTestId('form-error').textContent?.length ?? 0).toBeGreaterThan(0);
    expect(h.entry()?.calculate).toBeUndefined();
  });

  it('"Änderung vor dem Absenden erforderlich" follows the prefill', async () => {
    const h = await openPanel('foto');
    expect(screen.queryByTestId('cfg-change')).toBeNull();
    await userEvent.selectOptions(screen.getByTestId('cfg-prefill'), 'last_value');
    await userEvent.click(screen.getByTestId('cfg-change'));
    expect(h.entry()?.constraint).toBe('value != self.foto');
    expect(h.entry()?.constraint_message).toEqual({ de: 'Der Wert muss geändert werden' });
    await userEvent.selectOptions(screen.getByTestId('cfg-prefill'), 'empty');
    expect(h.entry()?.constraint).toBeUndefined();
  });

  it('a date can be prefilled with today', async () => {
    const h = await openPanel('faellig_am', clean(), 'library');
    await userEvent.click(screen.getByTestId('cfg-now'));
    expect(h.entry()?.calculate).toBe('today()');
    expect((screen.getByTestId('cfg-prefill') as HTMLSelectElement).value).toBe('computed');
    await userEvent.click(screen.getByTestId('cfg-now'));
    expect(h.entry()?.calculate).toBeUndefined();
  });
});

describe('validation of a text and the limits of a multiselect', () => {
  it('min and max length are a constraint with a message', async () => {
    const h = await openPanel('beschreibung', clean(), 'library');
    await typeInto(screen.getByTestId('cfg-min'), '2');
    await typeInto(screen.getByTestId('cfg-max'), '40');
    expect(h.entry()?.constraint).toBe('size(value) >= 2 && size(value) <= 40');
    expect(h.entry()?.constraint_message).toEqual({ de: 'Zwischen 2 und 40 Zeichen' });
    expect(formOf(reloaded(h.last()).effective(), T)['beschreibung']?.constraint).toBe(
      'size(value) >= 2 && size(value) <= 40',
    );
    await typeInto(screen.getByTestId('cfg-min'), '');
    await typeInto(screen.getByTestId('cfg-max'), '');
    expect(h.entry()?.constraint).toBeUndefined();
  });

  it('a constraint of its own (Code view) is left alone and says so', async () => {
    const h = await openPanel('befund');
    expect(screen.getByTestId('cfg-foreign').textContent).toContain('eigene Prüfregel');
    expect(screen.queryByTestId('cfg-min')).toBeNull();
    expect(h.entry()?.constraint).toBe('value != self.befund');
  });

  it('a field without a text, number or choices has no validation block', async () => {
    await openPanel('faellig_am', clean(), 'library');
    expect(screen.queryByTestId('cfg-validation')).toBeNull();
  });
});
