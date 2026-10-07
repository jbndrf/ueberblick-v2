// @vitest-environment jsdom
// WP-445: the provenance mark on a form field card and its "⋯" menu (Auf Vorlage zurücksetzen, Ausblenden).
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
import { registerFormEditor } from './register';

afterEach(cleanup);

const T = 'befund_ergaenzen';
const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

async function openEditor(doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerFieldPane(registry);
  registerFormEditor(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  await userEvent.click(document.querySelector(`[data-path="tasks.${T}"]`) as HTMLElement);
  await userEvent.click(screen.getByRole('tab', { name: 'Formular' }));
  await userEvent.click(screen.getByTestId('step-0-edit'));
  return { last: (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc };
}

const card = (key = 'befund'): HTMLElement => document.querySelector(`[data-key="${key}"]`) as HTMLElement;
const mark = (key = 'befund'): string | undefined =>
  within(card(key)).queryByTestId('provenance-mark')?.getAttribute('data-provenance') ?? undefined;

describe('the provenance mark on a field card', () => {
  it('shows Vorlage for a template field, Geändert after a change, and the reset puts it back', async () => {
    const h = await openEditor();
    expect(mark()).toBe('template');
    expect(within(card()).getByTestId('provenance-mark').textContent).toContain('Vorlage');

    await userEvent.click(within(card()).getByTestId('card-label'));
    await userEvent.clear(screen.getByTestId('card-label-input'));
    await userEvent.type(screen.getByTestId('card-label-input'), 'Zustand{Enter}');
    expect(mark()).toBe('changed');
    expect(within(card()).getByTestId('provenance-mark').textContent).toContain('Geändert');

    await userEvent.click(within(card()).getByTestId('field-menu'));
    await userEvent.click(await screen.findByTestId('menu-reset'));
    expect(mark()).toBe('template');
    expect(h.last().provenance('types.baum.properties.befund')).toBe('template');
    expect(h.last().effective().types?.['baum']?.properties['befund']?.label).toEqual(
      clean().effective().types?.['baum']?.properties['befund']?.label,
    );
  });

  it('offers no reset on an unchanged template field, and calls the delete "Ausblenden"', async () => {
    await openEditor();
    await userEvent.click(within(card()).getByTestId('field-menu'));
    expect(screen.queryByTestId('menu-reset')).toBeNull();
    expect((await screen.findByTestId('menu-delete')).textContent).toContain('Ausblenden');
  });

  it('marks a field the project added Hinzugefügt, with the plain delete and no reset', async () => {
    let doc = clean();
    doc = doc.apply({
      kind: 'add',
      path: 'types.baum.properties.notiz',
      value: { type: 'text', label: { de: 'Notiz' } },
    }).doc;
    doc = doc.apply({ kind: 'add', path: `tasks.${T}.form.notiz`, value: {} }).doc;
    await openEditor(doc);
    expect(mark('notiz')).toBe('added');
    await userEvent.click(within(card('notiz')).getByTestId('field-menu'));
    expect(screen.queryByTestId('menu-reset')).toBeNull();
    expect((await screen.findByTestId('menu-delete')).textContent).toContain('Feld vollständig löschen');
  });
});
