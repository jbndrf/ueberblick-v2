// @vitest-environment jsdom
// WP-352: the task pane's Formular and Ergebnisse tabs and Definition's Farbe, Symbol and Bestätigung inside
// the builder frame, one test per acceptance box and per ported v3 element.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import './shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from './index';

afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function open(task: string, doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  const select = async () =>
    userEvent.click(document.querySelector(`[data-path="tasks.${task}"]`) as HTMLElement);
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  const def = () => last().effective().tasks?.[task];
  return { select, last, def, onchange };
}

const tab = (name: string) => screen.getByRole('tab', { name });
const T = 'befund_ergaenzen';

async function pickProperty(group: HTMLElement, name: RegExp): Promise<void> {
  await userEvent.click(within(group).getAllByRole('button')[0] as HTMLElement);
  await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name }));
  await userEvent.keyboard('{Escape}');
}

describe('Formular', () => {
  it('lists the steps in order with up, down, remove and "Felder bearbeiten" (WP-380 opens the form editor)', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Formular'));
    const rows = screen.getByTestId('steps').querySelectorAll('li.step');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-kind')).toBe('form');
    expect(screen.getByRole('button', { name: 'Schritt 1 nach oben' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Schritt 1 nach unten' })).toHaveProperty('disabled', true);
    expect(screen.getByTestId('step-0-edit')).toHaveProperty('disabled', false);
    expect(screen.getByTestId('add-form')).toHaveProperty('disabled', true);
  });

  it('"+ Standort" and "+ Schnellbearbeitung" (with its property picker) append steps; the order is the YAML order', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Formular'));
    await userEvent.click(screen.getByTestId('add-location'));
    expect(h.def()?.steps).toEqual([{ kind: 'form' }, { kind: 'location', property: 'geometrie' }]);
    expect((screen.getByTestId('step-1-location') as HTMLSelectElement).value).toBe('geometrie');

    await userEvent.click(screen.getByTestId('add-quick-edit'));
    await pickProperty(screen.getByTestId('steps-picker-select'), /Höhe \(m\)/);
    await userEvent.click(screen.getByTestId('steps-picker-add'));
    expect(h.def()?.steps).toEqual([
      { kind: 'form' },
      { kind: 'location', property: 'geometrie' },
      { kind: 'quick_edit', properties: ['hoehe_m'] },
    ]);
    expect(screen.queryByTestId('steps-picker')).toBeNull();
    expect(h.last().entityYaml(`tasks.${T}`).text).toMatch(
      /kind: form[\s\S]*kind: location[\s\S]*kind: quick_edit/,
    );
  });

  it('↑ and ↓ move steps, remove takes one, and the last other step leaves `steps` out', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Formular'));
    await userEvent.click(screen.getByTestId('add-location'));
    await userEvent.click(screen.getByRole('button', { name: 'Schritt 2 nach oben' }));
    expect(h.def()?.steps?.map((s) => s.kind)).toEqual(['location', 'form']);
    await userEvent.click(screen.getByRole('button', { name: 'Schritt 1 nach unten' }));
    expect(h.def()?.steps?.map((s) => s.kind)).toEqual(['form', 'location']);
    await userEvent.click(screen.getByTestId('step-1-remove'));
    expect(h.def()?.steps).toBeUndefined();
    expect(screen.getByTestId('steps').querySelectorAll('li.step').length).toBe(1);
  });

  it('removing the form step asks first and lists the fields that go with it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const h = open(T);
    await h.select();
    await user.click(tab('Formular'));
    await user.click(screen.getByTestId('add-location'));
    await user.click(screen.getByTestId('step-0-remove'));
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('befund');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(h.def()?.form).toBeDefined();
    await user.click(screen.getByTestId('step-0-remove'));
    await user.click(await screen.findByTestId('confirm-delete-action'));
    expect(h.def()?.form).toBeUndefined();
    expect(h.def()?.steps).toEqual([{ kind: 'location', property: 'geometrie' }]);
  });

  it('a task with no steps shows the empty state', async () => {
    // (system_faellig no longer lists: it is the outcome of its automatic action, C-004)
    const bare = clean().apply({
      kind: 'set',
      path: 'tasks.leer_aufgabe',
      value: { label: { de: 'Leer' }, on: 'baum' },
    }).doc;
    const h = open('leer_aufgabe', bare);
    await h.select();
    await userEvent.click(tab('Formular'));
    expect(screen.getByTestId('steps-empty').textContent).toContain('Noch keine Schritte');
    await userEvent.click(screen.getByTestId('add-form'));
    expect(h.def()?.form).toEqual({});
  });
});

describe('Ergebnisse', () => {
  it('"Übergang zu" writes the stage step the canvas draws, and "Kein Übergang" removes it', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Ergebnis'));
    expect(screen.getByTestId('outcomes-empty').textContent).toContain('Noch keine Aktionen');
    await userEvent.selectOptions(screen.getByTestId('outcome-transition'), 'kontrolliert');
    expect(h.def()?.then).toEqual([{ set: { stage: "'kontrolliert'" } }]);
    await userEvent.selectOptions(screen.getByTestId('outcome-transition'), '');
    expect(h.def()?.then).toBeUndefined();
  });

  it("a step with `of` shows its target, so it does not look like it acts on the task's subject", async () => {
    const base = clean();
    const doc = base.apply({
      kind: 'set',
      path: 'tasks.zuweisen.then',
      value: [{ lifecycle: 'deleted', of: 'self.kinder' }, { lifecycle: 'deleted' }],
    }).doc;
    const h = open('zuweisen', doc);
    await h.select();
    await userEvent.click(tab('Ergebnis'));
    expect(screen.getByTestId('outcome-0-of').textContent).toBe('für self.kinder');
    expect(screen.queryByTestId('outcome-1-of')).toBeNull();
  });

  it('each action kind writes its step; a second create is refused with the hint', async () => {
    const h = open('zuweisen');
    await h.select();
    await userEvent.click(tab('Ergebnis'));
    await userEvent.click(screen.getByTestId('add-set'));
    expect(h.def()?.then?.[0]?.set).toEqual({ befund: "''" });
    await userEvent.click(screen.getByTestId('add-clear'));
    await userEvent.click(screen.getByTestId('add-status'));
    await userEvent.click(screen.getByTestId('add-lifecycle'));
    expect(h.def()?.then?.map((s) => Object.keys(s)[0])).toEqual(['set', 'set', 'set', 'lifecycle']);
    expect(h.def()?.then?.[1]?.set).toMatchObject({ art: null });
    expect(h.def()?.then?.[2]?.set).toMatchObject({ vitalitaet: "'v0'" });
    expect(h.def()?.then?.[3]).toEqual({ lifecycle: 'completed' });

    await userEvent.selectOptions(screen.getByTestId('outcome-3-lifecycle'), 'archived');
    expect(h.def()?.then?.[3]).toEqual({ lifecycle: 'archived' });

    await userEvent.click(screen.getByTestId('add-create'));
    expect(screen.getByTestId('outcome-create')).toBeTruthy();
    await userEvent.click(screen.getByTestId('add-create'));
    expect(screen.getByTestId('outcome-error').textContent).toContain('weitere Aufgabe');
  });

  it('a set row takes a literal or an expression; one the checker rejects shows in place and is not applied', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Ergebnis'));
    await userEvent.click(screen.getByTestId('add-set'));
    const input = screen.getByLabelText('Wert oder Ausdruck') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "'geprüft'");
    await userEvent.tab();
    expect(h.def()?.then?.[0]?.set).toEqual({ befund: "'geprüft'" });
    const before = h.onchange.mock.calls.length;
    await userEvent.clear(input);
    await userEvent.type(input, 'self.gibts_nicht + 1');
    await userEvent.tab();
    expect((await screen.findByTestId('outcome-0-text-error')).textContent).toContain('Nicht übernommen');
    expect(h.onchange.mock.calls.length).toBe(before);
  });

  it('"nur wenn …" and "sonst" write the step condition and round-trip', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Ergebnis'));
    await userEvent.click(screen.getByTestId('add-lifecycle'));
    await userEvent.selectOptions(screen.getByTestId('outcome-0-when'), 'when');
    await userEvent.click(screen.getByRole('button', { name: 'Bedingung hinzufügen' }));
    expect(h.def()?.then?.[0]?.when).toMatch(/^self\.\w+ == null$/);
    await userEvent.selectOptions(screen.getByTestId('outcome-0-when'), 'otherwise');
    expect(h.def()?.then?.[0]).toEqual({ lifecycle: 'completed', otherwise: true });
    await userEvent.selectOptions(screen.getByTestId('outcome-0-when'), 'always');
    expect(h.def()?.then?.[0]).toEqual({ lifecycle: 'completed' });
  });

  it('↑ and ↓ order the rows and remove takes one', async () => {
    const h = open(T);
    await h.select();
    await userEvent.click(tab('Ergebnis'));
    await userEvent.click(screen.getByTestId('add-lifecycle'));
    await userEvent.click(screen.getByTestId('add-clear'));
    await userEvent.click(screen.getByRole('button', { name: 'Aktion 2 nach oben' }));
    expect(h.def()?.then?.map((s) => Object.keys(s)[0])).toEqual(['set', 'lifecycle']);
    await userEvent.click(screen.getByTestId('outcome-0-remove'));
    await userEvent.click(screen.getByTestId('outcome-0-remove'));
    expect(h.def()?.then).toBeUndefined();
  });
});

describe('Definition: Farbe, Symbol, Bestätigung', () => {
  it('write `button` and `confirm`', async () => {
    const h = open('kontrolle');
    await h.select();
    const color = screen.getByTestId('task-color') as HTMLInputElement;
    await userEvent.type(color, 'danger');
    await userEvent.tab();
    expect(h.def()?.button).toEqual({ color: 'danger' });
    await userEvent.type(screen.getByTestId('task-icon'), 'triangle-alert');
    await userEvent.tab();
    expect(h.def()?.button).toEqual({ color: 'danger', icon: 'triangle-alert' });

    expect(screen.queryByTestId('task-confirm-message')).toBeNull();
    await userEvent.click(screen.getByTestId('task-confirm'));
    expect(h.def()?.confirm).toEqual({ de: 'Soll die Aufgabe wirklich ausgeführt werden?' });
    const message = screen.getByTestId('task-confirm-message') as HTMLInputElement;
    await userEvent.clear(message);
    await userEvent.type(message, 'Baum wirklich kontrollieren?');
    await userEvent.tab();
    expect(h.def()?.confirm).toEqual({ de: 'Baum wirklich kontrollieren?' });
    await userEvent.click(screen.getByTestId('task-confirm'));
    expect(h.def()?.confirm).toBeUndefined();
    expect(screen.queryByTestId('task-confirm-message')).toBeNull();
  });

  it('a colour that is no registry key and no hex shows the German refusal line and is not applied', async () => {
    const h = open('kontrolle');
    await h.select();
    await userEvent.type(screen.getByTestId('task-color'), 'pink');
    await userEvent.tab();
    expect((await screen.findByTestId('task-error')).textContent).toContain(
      'Nicht übernommen: Die Datei passt nicht zum Schema',
    );
    expect(h.onchange).not.toHaveBeenCalled();
  });
});

describe('Formular on a template task whose steps come from the template (WP-446)', () => {
  it('"+ Formular" and the form step\'s remove button change the steps without a refusal note', async () => {
    const h = open('baum_bearbeiten');
    await h.select();
    await userEvent.click(tab('Formular'));
    expect(screen.getByTestId('steps').querySelectorAll('li.step').length).toBe(2);
    await userEvent.click(screen.getByTestId('add-form'));
    expect(h.def()?.steps?.map((s) => s.kind)).toEqual(['quick_edit', 'location', 'form']);
    expect(h.def()?.form).toEqual({});
    expect(screen.queryByTestId('task-error')).toBeNull();
    await userEvent.click(screen.getByTestId('step-2-remove'));
    expect(h.def()?.steps?.map((s) => s.kind)).toEqual(['quick_edit', 'location']);
    expect(h.def()?.form).toBeUndefined();
    expect(screen.queryByTestId('task-error')).toBeNull();
  });
});
