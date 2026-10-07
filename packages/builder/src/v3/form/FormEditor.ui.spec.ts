// @vitest-environment jsdom
// WP-380: the form editor inside the builder frame, one test per acceptance box and per ported v3 element. A drag
// needs a layout engine and a pointer: the e2e (builder-form-editor.spec.ts) does it; here every edit goes through
// the palettes, which end in the same ops as the drop.
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { pageBreakOps } from './ops';
import { registerFormEditor } from './register';

afterEach(cleanup);

const T = 'kontrolle';
const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

async function openEditor(task = T, doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerFieldPane(registry);
  registerFormEditor(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  await userEvent.click(document.querySelector(`[data-path="tasks.${task}"]`) as HTMLElement);
  await userEvent.click(screen.getByRole('tab', { name: 'Formular' }));
  await userEvent.click(screen.getByTestId('step-0-edit'));
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  const keys = (): string[] => Object.keys(formOf(last().effective(), task));
  const cards = (): string[] =>
    screen.queryAllByTestId('field-card').map((c) => c.getAttribute('data-key') ?? '');
  return { last, keys, cards, onchange };
}

describe('the editor frame', () => {
  it('"Felder bearbeiten" opens the editor in place of the task pane; the close button goes back', async () => {
    await openEditor();
    expect(screen.getByTestId('form-editor')).toBeTruthy();
    expect(screen.queryByTestId('task-pane')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Felder bearbeiten' })).toBeTruthy();
    expect(screen.getByText('Formular der Aufgabe „Regelkontrolle“')).toBeTruthy();
    await userEvent.click(screen.getByTestId('form-close'));
    expect(screen.getByTestId('task-pane')).toBeTruthy();
    expect(screen.queryByTestId('form-editor')).toBeNull();
  });

  it('shows the form as cards in order, with the required star, validation and condition badges', async () => {
    const h = await openEditor();
    expect(h.cards()).toEqual(['vitalitaet', 'befund', 'foto', 'hoehe_m', 'hoehe_klasse']);
    const befund = screen.getAllByTestId('field-card')[1] as HTMLElement;
    expect(within(befund).getByTestId('card-label').textContent).toContain('*');
    expect(within(befund).getByTitle('Hat Prüfregeln')).toBeTruthy();
    expect(
      within(screen.getAllByTestId('field-card')[2] as HTMLElement).getByTitle(
        'Wird nur unter einer Bedingung angezeigt',
      ),
    ).toBeTruthy();
  });
});

describe('palettes', () => {
  it('start collapsed to icons; the chevron expands them to label and description', async () => {
    await openEditor();
    const types = screen.getByTestId('form-types');
    expect(within(types).queryByText('Einzeiliges Textfeld')).toBeNull();
    await userEvent.click(screen.getByTestId('palette-toggle'));
    expect(within(types).getByText('Einzeiliges Textfeld')).toBeTruthy();
    expect(within(screen.getByTestId('form-library')).getByText('Feldbibliothek')).toBeTruthy();
  });

  it('a field type adds a new property and puts it at the end of the form, with all roles allowed to write it', async () => {
    const h = await openEditor();
    await userEvent.click(screen.getByTestId('tile-dropdown'));
    expect(h.keys().at(-1)).toBe('neues_feld');
    const file = h.last().effective();
    expect(file.types?.['baum']?.properties['neues_feld']).toMatchObject({
      type: 'select',
      label: { de: 'Neues Feld' },
    });
    expect(file.types?.['baum']?.permissions?.write).toMatchObject({ neues_feld: '$all' });
    expect(h.cards().at(-1)).toBe('neues_feld');
    await userEvent.click(screen.getByTestId('tile-dropdown'));
    expect(h.keys().at(-1)).toBe('neues_feld_2');
  });

  it('"Langtext" is a text property with the appearance multiline; "Smart Dropdown" a select with a choice filter', async () => {
    const h = await openEditor();
    await userEvent.click(screen.getByTestId('tile-long_text'));
    expect(h.last().effective().tasks?.[T]?.form?.['neues_feld']).toMatchObject({ appearance: 'multiline' });
    expect((screen.getByTestId('tile-smart_dropdown') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the library adds an existing property; one that is in the form is greyed', async () => {
    const h = await openEditor('befund_ergaenzen');
    expect((screen.getByTestId('library-befund') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId('library-art'));
    expect(h.keys()).toEqual(['befund', 'art']);
    expect((screen.getByTestId('library-art') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the preview', () => {
  it('a card has no up, down, width or new-page button: drag and drop is the only way (WP-1053)', async () => {
    await openEditor();
    const card = document.querySelector('[data-key="foto"]') as HTMLElement;
    for (const id of ['field-up', 'field-down', 'field-width-left', 'field-width-full', 'field-page']) {
      expect(within(card).queryByTestId(id)).toBeNull();
    }
    expect(within(card).getByTestId('field-remove')).toBeTruthy();
  });

  it('a second page tab exists when a field starts a page; its title is the page title and goes to the file', async () => {
    // The page break is made by a drop (e2e); here the file already has it, as after such a drop.
    let doc = clean();
    for (const op of pageBreakOps(doc, T, 'baum', 'foto', true)) doc = doc.apply(op).doc;
    const h = await openEditor(T, doc);
    expect(screen.getByTestId('page-tab-1')).toBeTruthy();
    expect(screen.getByTestId('page-select-0').textContent).toBe('Seite 1');
    await userEvent.click(screen.getByTestId('page-select-1'));
    expect(screen.getAllByTestId('field-card').map((c) => c.getAttribute('data-key'))).toEqual([
      'foto',
      'hoehe_m',
      'hoehe_klasse',
    ]);
    await userEvent.click(screen.getByTestId('page-rename'));
    await userEvent.clear(screen.getByTestId('page-title-input'));
    await userEvent.type(screen.getByTestId('page-title-input'), 'Messwerte{Enter}');
    expect(h.last().effective().tasks?.[T]?.form?.['foto']?.page).toEqual({ label: { de: 'Messwerte' } });
    expect(screen.getByTestId('page-select-1').textContent).toBe('Messwerte');
  });

  it('the page description is written on blur', async () => {
    const h = await openEditor();
    await userEvent.type(screen.getByTestId('page-description'), 'Erst das Wichtige');
    await userEvent.tab();
    expect(h.last().effective().tasks?.[T]?.form?.['vitalitaet']?.page).toEqual({
      hint: { de: 'Erst das Wichtige' },
    });
  });

  it('"+" adds a pending page that becomes real with its first field; X takes a page out and keeps its fields', async () => {
    const h = await openEditor();
    await userEvent.click(screen.getByTestId('page-add'));
    expect(screen.getByTestId('page-tab-1')).toBeTruthy();
    expect(screen.getByText('Diese Seite entsteht mit ihrem ersten Feld.')).toBeTruthy();
    await userEvent.click(screen.getByTestId('tile-number'));
    expect(h.last().effective().tasks?.[T]?.form?.['neues_feld']?.page).toEqual({});
    expect(screen.getAllByTestId('field-card').map((c) => c.getAttribute('data-key'))).toEqual([
      'neues_feld',
    ]);
    await userEvent.click(screen.getByTestId('page-delete'));
    expect(h.last().effective().tasks?.[T]?.form?.['neues_feld']?.page).toBeUndefined();
    expect(h.keys().at(-1)).toBe('neues_feld');
    expect(screen.queryByTestId('page-tab-1')).toBeNull();
  });

  it('remove takes the field out of the form (the property stays), and the library offers it again', async () => {
    const h = await openEditor();
    await userEvent.click(
      within(document.querySelector('[data-key="foto"]') as HTMLElement).getByTestId('field-remove'),
    );
    expect(h.keys()).toEqual(['vitalitaet', 'befund', 'hoehe_m', 'hoehe_klasse']);
    expect(h.last().effective().types?.['baum']?.properties['foto']).toBeDefined();
    expect((screen.getByTestId('library-foto') as HTMLButtonElement).disabled).toBe(false);
  });

  it('click the label to rename the property in place; Escape cancels', async () => {
    const h = await openEditor();
    const card = () => document.querySelector('[data-key="befund"]') as HTMLElement;
    await userEvent.click(within(card()).getByTestId('card-label'));
    await userEvent.type(screen.getByTestId('card-label-input'), ' neu{Escape}');
    expect(h.last()).toBeUndefined();
    await userEvent.click(within(card()).getByTestId('card-label'));
    await userEvent.clear(screen.getByTestId('card-label-input'));
    await userEvent.type(screen.getByTestId('card-label-input'), 'Zustand{Enter}');
    expect(h.last().effective().types?.['baum']?.properties['befund']?.label).toMatchObject({
      de: 'Zustand',
    });
  });

  it('an empty form shows the empty state', async () => {
    const h = await openEditor('befund_ergaenzen');
    await userEvent.click(
      within(document.querySelector('[data-key="befund"]') as HTMLElement).getByTestId('field-remove'),
    );
    expect(h.cards()).toEqual([]);
    expect(screen.getByTestId('form-empty').textContent).toContain('Noch keine Felder');
  });

  it('the "⋯" menu has remove, delete entirely (with the confirm) and copy key', async () => {
    const h = await openEditor('befund_ergaenzen');
    await userEvent.click(screen.getByTestId('field-menu'));
    expect(await screen.findByTestId('menu-delete')).toBeTruthy();
    expect(screen.getByTestId('menu-copy-key')).toBeTruthy();
    await userEvent.click(screen.getByTestId('menu-delete'));
    // WP-490: befund comes from the template, so deleting it hides it and the dialog says so.
    expect(await screen.findByText('Feld „Befund“ ausblenden?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ausblenden' }));
    expect(h.last().effective().types?.['baum']?.properties['befund']).toBeUndefined();
    expect(h.keys()).toEqual([]);
  });
});

describe('selecting a field', () => {
  it('opens its settings in place of the palettes and the preview; "Felddefinition bearbeiten" drills into WP-337\'s pane, back returns step by step', async () => {
    await openEditor();
    await userEvent.click(document.querySelector('[data-key="befund"]') as HTMLElement);
    expect(screen.getByTestId('field-config').getAttribute('data-key')).toBe('befund');
    expect(screen.queryByTestId('form-preview')).toBeNull();
    expect(screen.queryByTestId('field-pane')).toBeNull();
    await userEvent.click(screen.getByTestId('cfg-edit-definition'));
    expect(screen.getByTestId('field-pane').getAttribute('data-path')).toBe('types.baum.properties.befund');
    await userEvent.click(screen.getByTestId('form-def-back'));
    expect(screen.getByTestId('field-config')).toBeTruthy();
    await userEvent.click(screen.getByTestId('form-field-back'));
    expect(screen.getByTestId('form-preview')).toBeTruthy();
    expect(screen.queryByTestId('field-config')).toBeNull();
  });

  it('hiding a template field in the pane ends back at the form', async () => {
    const h = await openEditor('befund_ergaenzen');
    await userEvent.click(screen.getByTestId('field-card'));
    await userEvent.click(screen.getByTestId('cfg-edit-definition'));
    // WP-490: befund is a template field, so the pane hides it (same wording as the card menu).
    await userEvent.click(screen.getByRole('button', { name: 'Ausblenden' }));
    expect(await screen.findByText('Feld „Befund“ ausblenden?')).toBeTruthy();
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ausblenden' }),
    );
    expect(screen.getByTestId('form-preview')).toBeTruthy();
    expect(h.last().effective().types?.['baum']?.properties['befund']).toBeUndefined();
  });
});

describe('Formular löschen', () => {
  it('asks first, then takes the form step out and returns to the task', async () => {
    const h = await openEditor('befund_ergaenzen');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByTestId('form-delete'));
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('Formular aus der Aufgabe entfernen?');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(h.onchange).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('form-delete'));
    await user.click(await screen.findByTestId('confirm-delete-action'));
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.form).toBeUndefined();
    expect(screen.getByTestId('task-pane')).toBeTruthy();
  });
});
