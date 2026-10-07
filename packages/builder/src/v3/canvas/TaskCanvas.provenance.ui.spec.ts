// @vitest-environment jsdom
// WP-454: provenance on the canvas: the small mark on a stage node and a task row, and "Auf Vorlage zurücksetzen" /
// "Ausblenden" in the right-click menu (WP-435), with the lock of the template.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import DummyInspector from '../shell/DummyInspector.testing.svelte';
import { createBuilderRegistry } from '../shell/registry';
import './jsdom.testing';
import { registerCanvas } from './index';

const LOCK = 'lock:\n  - types.baum.properties.stage.options\n';
const free = (): Doc => openProject(musterstadt.templateSrc.replace(LOCK, ''), musterstadt.overlaySrc);

function mount(doc: Doc) {
  const onchange = vi.fn<(d: Doc) => void>();
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  for (const kind of ['stage', 'task', 'rule', 'none'] as const)
    registry.registerInspector(kind, DummyInspector);
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  return { last: () => onchange.mock.calls.at(-1)?.[0] as Doc };
}
const task = (key: string) => document.querySelector(`[data-task-id="${key}"]`) as HTMLElement;
const stage = (key: string) => document.querySelector(`[data-stage-node="${key}"]`) as HTMLElement;
const markOf = (el: HTMLElement) => el.querySelector('[data-testid="provenance-mark"]');

async function menuOf(el: HTMLElement): Promise<HTMLElement[]> {
  await fireEvent.contextMenu(el, { clientX: 40, clientY: 40 });
  return screen.findAllByRole('menuitem');
}
const names = (items: HTMLElement[]) => items.map((i) => i.textContent?.trim());

describe('provenance on the canvas (WP-454)', () => {
  it('a task row carries the mark of where it comes from; a changed one offers the reset in its menu', async () => {
    const m = mount(free());
    await vi.waitFor(() => expect(task('kontrolle')).toBeTruthy());
    expect(markOf(task('kontrolle'))?.getAttribute('data-provenance')).toBe('changed');
    const items = await menuOf(task('kontrolle'));
    expect(names(items)).toContain('Auf Vorlage zurücksetzen');
    await fireEvent.click(
      items.find((i) => i.textContent?.trim() === 'Auf Vorlage zurücksetzen') as HTMLElement,
    );
    expect(m.last().provenance('tasks.kontrolle')).toBe('template');
  });

  it('the delete of a template task reads "Ausblenden", asks, and hides it', async () => {
    const m = mount(free());
    await vi.waitFor(() => expect(task('befund_ergaenzen')).toBeTruthy());
    const items = await menuOf(task('befund_ergaenzen'));
    expect(names(items)).toContain('Ausblenden');
    expect(names(items)).not.toContain('Auf Vorlage zurücksetzen');
    await fireEvent.click(items.find((i) => i.textContent?.trim() === 'Ausblenden') as HTMLElement);
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('ausblenden?');
    await fireEvent.click(screen.getByTestId('confirm-delete-action'));
    expect(m.last().overlay().hide).toContain('tasks.befund_ergaenzen');
  });

  it('a stage node carries the mark; a template stage is hidden, not deleted', async () => {
    const m = mount(free());
    await vi.waitFor(() => expect(stage('massnahme')).toBeTruthy());
    expect(markOf(stage('massnahme'))?.getAttribute('data-provenance')).toBe('template');
    const items = await menuOf(stage('massnahme'));
    expect(names(items)).toContain('Ausblenden');
    expect(names(items)).not.toContain('Phase löschen');
    await fireEvent.click(items.find((i) => i.textContent?.trim() === 'Ausblenden') as HTMLElement);
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('Phase');
    expect(dialog.textContent).toContain('Die Phase bleibt in der Vorlage');
    await fireEvent.click(screen.getByTestId('confirm-delete-action'));
    expect(m.last().overlay().hide).toContain('types.baum.properties.stage.options.massnahme');
  });

  it('a stage the template locks shows the lock and its "Ausblenden" is disabled', async () => {
    mount(openProject(musterstadt.templateSrc, musterstadt.overlaySrc));
    await vi.waitFor(() => expect(stage('massnahme')).toBeTruthy());
    expect(stage('massnahme').querySelector('[data-testid="provenance-lock"]')).not.toBeNull();
    const items = await menuOf(stage('massnahme'));
    const hide = items.find((i) => i.textContent?.trim() === 'Ausblenden') as HTMLButtonElement;
    expect(hide.disabled).toBe(true);
  });
});
