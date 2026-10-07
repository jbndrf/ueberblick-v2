// @vitest-environment jsdom
// WP-445: provenance mark, reset and hide on the task pane.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
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
  return { select, last, onchange };
}

describe('provenance (WP-445)', () => {
  const mark = (): string | undefined =>
    screen.queryByTestId('provenance-mark')?.getAttribute('data-provenance') ?? undefined;

  it('marks a template task Vorlage, a changed one Geändert, and the reset puts it back', async () => {
    const h = open('kontrolle');
    await h.select();
    expect(mark()).toBe('changed');
    expect(screen.getByTestId('provenance-mark').textContent).toContain('Geändert');
    await userEvent.click(screen.getByTestId('task-reset'));
    expect(h.last().provenance('tasks.kontrolle')).toBe('template');
    expect(mark()).toBe('template');
    expect(screen.queryByTestId('task-reset')).toBeNull();
    expect(screen.getByTestId('provenance-mark').textContent).toContain('Vorlage');
  });

  it('calls the delete of a template task Ausblenden, and hides it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const h = open('befund_ergaenzen');
    await h.select();
    expect(screen.getByTestId('task-delete').textContent).toContain('Ausblenden');
    await user.click(screen.getByTestId('task-delete'));
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('ausblenden?');
    expect(dialog.textContent).toContain('Die Aufgabe bleibt in der Vorlage');
    expect(dialog.textContent).not.toContain('nicht rückgängig');
    expect(screen.getByTestId('confirm-delete-action').textContent).toContain('Ausblenden');
    await user.click(screen.getByTestId('confirm-delete-action'));
    expect(h.last().overlay().hide).toContain('tasks.befund_ergaenzen');
  });

  it('a task the project added is Hinzugefügt, with "Aufgabe löschen" and no reset', async () => {
    const doc = clean().apply({
      kind: 'add',
      path: 'tasks.eigene',
      value: { label: { de: 'Eigene' }, on: 'baum', form: {} },
    }).doc;
    const h = open('eigene', doc);
    await h.select();
    expect(mark()).toBe('added');
    expect(screen.queryByTestId('task-reset')).toBeNull();
    expect(screen.getByTestId('task-delete').textContent).toContain('Aufgabe löschen');
  });

  it('a task the template locks shows the lock with its reason and cannot be hidden', async () => {
    const src = musterstadt.templateSrc.replace(
      'lock:\n  - types.baum.properties.stage.options',
      'lock:\n  - types.baum.properties.stage.options\n  - tasks.befund_ergaenzen',
    );
    expect(src).not.toBe(musterstadt.templateSrc);
    const h = open('befund_ergaenzen', openProject(src, musterstadt.overlaySrc));
    await h.select();
    expect(screen.getByTestId('provenance-lock').getAttribute('title')).toContain('tasks.befund_ergaenzen');
    expect((screen.getByTestId('task-delete') as HTMLButtonElement).disabled).toBe(true);
  });
});
