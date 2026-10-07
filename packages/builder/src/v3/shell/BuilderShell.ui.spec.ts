// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { problemItems } from '../../problems/model';
import { musterstadt } from '../../testing/golden';
import BuilderShell from './BuilderShell.svelte';
import DummyInspector from './DummyInspector.testing.svelte';
import { createBuilderRegistry, type BuilderRegistry } from './registry';
import '../task/shims.testing';

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const broken = (path: string, value: unknown): Doc => clean().apply({ kind: 'set', path, value }).doc;

function frame(over: Record<string, unknown> = {}, registry: BuilderRegistry = createBuilderRegistry()) {
  return render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry, ...over });
}

describe('frame', () => {
  it('shows the three panes and the toolbar of v3', () => {
    frame();
    expect(screen.getByTestId('builder-catalog')).toBeTruthy();
    expect(screen.getByTestId('builder-center')).toBeTruthy();
    expect(screen.getByTestId('builder-inspector')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy();
    const views = screen.getByRole('group', { name: 'Ansicht' });
    expect(
      within(views)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim()),
    ).toEqual(['Workflow', 'Modell', 'Code']);
    expect((screen.getByTestId('type-name') as HTMLInputElement).value).toBe('Baum');
  });

  it('the view switch tells the host, marks the active view and hides the side panes in Code', async () => {
    const onviewchange = vi.fn();
    frame({ onviewchange });
    await userEvent.click(screen.getByRole('button', { name: 'Modell' }));
    expect(onviewchange).toHaveBeenCalledWith('model');
    expect(screen.getByRole('button', { name: 'Modell' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('builder-center').dataset['view']).toBe('model');
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.queryByTestId('builder-catalog')).toBeNull();
    expect(screen.queryByTestId('builder-inspector')).toBeNull();
  });

  it('follows the view of the address', () => {
    frame({ view: 'code' });
    expect(screen.getByTestId('builder-center').dataset['view']).toBe('code');
  });

  it('shows a registered middle view instead of the placeholder', () => {
    const registry = createBuilderRegistry();
    registry.registerView('workflow', DummyInspector);
    frame({}, registry);
    expect(screen.getByTestId('dummy-inspector')).toBeTruthy();
  });
});

describe('inspector registry', () => {
  it('shows the registered view for the selection kind, and a placeholder before that', async () => {
    const registry = createBuilderRegistry();
    registry.registerInspector('task', DummyInspector);
    frame({}, registry);
    expect(screen.queryByTestId('dummy-inspector')).toBeNull();
    expect(screen.getByTestId('builder-inspector').textContent).toContain('Wird in einem späteren Schritt');
    await userEvent.click(document.querySelector('[data-path="tasks.kontrolle"]') as HTMLElement);
    expect(screen.getByTestId('dummy-inspector').textContent).toBe('task:kontrolle');
  });
});

describe('Speichern', () => {
  it('saves the overlay through saveIf and rebases; the unsaved note goes', async () => {
    const onsave = vi.fn<(overlay: string) => Promise<'saved'>>(async () => 'saved');
    const ondirty = vi.fn();
    frame({ onsave, ondirty });
    await userEvent.click(screen.getByRole('button', { name: 'Schaltfläche' }));
    expect(screen.getByTestId('unsaved')).toBeTruthy();
    expect(ondirty).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onsave).toHaveBeenCalledTimes(1);
    expect(String(onsave.mock.calls[0]?.[0])).toContain('neue_aufgabe');
    expect(screen.queryByTestId('unsaved')).toBeNull();
    expect(ondirty).toHaveBeenLastCalledWith(false);
  });

  it('a conflict shows the message, keeps the work and the unsaved state', async () => {
    frame({ onsave: async () => 'conflict' });
    await userEvent.click(screen.getByRole('button', { name: 'Schaltfläche' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByRole('alert').textContent).toContain('woanders geändert');
    expect(screen.getByTestId('unsaved')).toBeTruthy();
  });

  it('a failed write says so', async () => {
    frame({ onsave: async () => 'failed' });
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByRole('alert').textContent).toContain('Speichern fehlgeschlagen');
  });
});

describe('problems badge', () => {
  it('counts the problems of the Objektart as Doc.problems() says', () => {
    const doc = broken('tasks.kontrolle.form.befund.relevant', 'gibts(');
    expect(doc.problems().length).toBeGreaterThan(0);
    frame({ doc });
    expect(screen.getByTestId('problem-count').textContent).toBe(String(doc.problems().length));
  });

  it('leaves out problems that sit in another Objektart', () => {
    const doc = broken('tasks.flaeche_bearbeiten.when', 'gibts(');
    const other = problemItems(doc, 'de').filter((p) => p.location.type === 'flaeche');
    expect(other.length).toBeGreaterThan(0);
    frame({ doc });
    expect(screen.getByTestId('problem-count').textContent).toBe(
      String(doc.problems().length - other.length),
    );
  });

  it('lists the entries on click; an entry runs the focus hook, else selects its entity', async () => {
    const doc = broken('tasks.kontrolle.form.befund.relevant', 'gibts(');
    const registry = createBuilderRegistry();
    registry.registerInspector('task', DummyInspector);
    const hook = vi.fn(() => false);
    registry.registerFocus(hook);
    frame({ doc }, registry);
    await userEvent.click(screen.getByTestId('problems-badge'));
    const list = screen.getByRole('region', { name: 'Probleme' });
    await userEvent.click(within(list).getAllByRole('button')[0] as HTMLElement);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dummy-inspector').textContent).toBe('task:kontrolle');
    expect(screen.queryByRole('region', { name: 'Probleme' })).toBeNull();
  });
});

describe('catalog', () => {
  it('"Aufgabe hinzufügen" adds a task to the draft, lists it and selects it', async () => {
    const onchange = vi.fn();
    const registry = createBuilderRegistry();
    registry.registerInspector('task', DummyInspector);
    frame({ onchange }, registry);
    const before = Number(screen.getByTestId('catalog-count-actions').textContent);
    await userEvent.click(screen.getByRole('button', { name: 'Formular' }));
    expect(onchange).toHaveBeenCalledTimes(1);
    const doc = onchange.mock.calls[0]?.[0] as Doc;
    expect(doc.effective().tasks?.['neue_aufgabe']).toMatchObject({ on: 'baum', form: {} });
    expect(Number(screen.getByTestId('catalog-count-actions').textContent)).toBe(before + 1);
    expect(screen.getByTestId('dummy-inspector').textContent).toBe('task:neue_aufgabe');
  });

  it('a stage on an Objektart without a process creates the process in one change (WP-508)', async () => {
    const onchange = vi.fn();
    frame({ type: 'flaeche', onchange });
    await userEvent.click(screen.getByRole('button', { name: 'Phase' }));
    expect(onchange).toHaveBeenCalledTimes(1);
    const doc = onchange.mock.calls[0]?.[0] as Doc;
    expect(doc.effective().types?.['flaeche']?.process?.property).toBe('stage');
  });

  it('a locked Automatisch chip is disabled with the lock wording and creates nothing (WP-515)', async () => {
    const locked = musterstadt.templateSrc.replace('lock:\n', 'lock:\n  - tasks\n');
    expect(locked).not.toBe(musterstadt.templateSrc);
    const doc = openProject(locked, musterstadt.overlaySrc);
    const onchange = vi.fn();
    frame({ doc, onchange });
    const chip = screen.getByRole('button', { name: 'Automatisch' }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Von der Vorlage gesperrt');
    await userEvent.click(chip);
    expect(onchange).not.toHaveBeenCalled();
    expect(doc.effective().tasks).toEqual(openProject(locked, musterstadt.overlaySrc).effective().tasks);
  });

  it('a locked stage option: the Phase chip is disabled with the lock wording, no engine text (WP-515)', async () => {
    // the golden template locks the stage options
    frame();
    const chip = screen.getByRole('button', { name: 'Phase' }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Von der Vorlage gesperrt');
    await userEvent.click(chip);
    expect(screen.getByRole('alert').textContent?.trim()).toBe('');
    expect(document.body.textContent).not.toContain('The template locks');
  });

  it('renaming the Objektart writes its label', async () => {
    const onchange = vi.fn();
    frame({ onchange });
    const input = screen.getByTestId('type-name') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Straßenbaum');
    await userEvent.tab();
    const doc = onchange.mock.calls.at(-1)?.[0] as Doc;
    expect(doc.effective().types?.['baum']?.label).toMatchObject({ de: 'Straßenbaum' });
  });
});

describe('Veröffentlichen (WP-360)', () => {
  it('has no button when the host brings no deploy overview', () => {
    frame();
    expect(screen.queryByTestId('deploy')).toBeNull();
  });

  it('opens the host overview straight away when nothing is unsaved', async () => {
    const ondeploy = vi.fn();
    const onsave = vi.fn<(overlay: string) => Promise<'saved'>>(async () => 'saved');
    frame({ ondeploy, onsave });
    await userEvent.click(screen.getByTestId('deploy'));
    expect(ondeploy).toHaveBeenCalledTimes(1);
    expect(onsave).not.toHaveBeenCalled();
  });

  it('saves unsaved changes first, then opens the overview', async () => {
    const order: string[] = [];
    const onsave = vi.fn<(overlay: string) => Promise<'saved'>>(async () => {
      order.push('save');
      return 'saved';
    });
    const ondeploy = vi.fn(() => void order.push('deploy'));
    frame({ ondeploy, onsave });
    await userEvent.click(screen.getByRole('button', { name: 'Schaltfläche' }));
    await userEvent.click(screen.getByTestId('deploy'));
    expect(order).toEqual(['save', 'deploy']);
  });

  it('Veröffentlichen during a pending save: the overview opens only after the save resolved', async () => {
    const order: string[] = [];
    let finish: (o: 'saved') => void = () => undefined;
    const onsave = vi.fn(
      () =>
        new Promise<'saved'>((r) => {
          finish = r;
        }),
    );
    const ondeploy = vi.fn(() => void order.push('deploy'));
    frame({ ondeploy, onsave });
    await userEvent.click(screen.getByRole('button', { name: 'Schaltfläche' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await userEvent.click(screen.getByTestId('deploy'));
    expect(ondeploy).not.toHaveBeenCalled();
    order.push('saved');
    finish('saved');
    await vi.waitFor(() => expect(ondeploy).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['saved', 'deploy']);
    expect(onsave).toHaveBeenCalledTimes(1);
  });

  it('does not open the overview when saving conflicted', async () => {
    const ondeploy = vi.fn();
    const onsave = vi.fn<(overlay: string) => Promise<'conflict'>>(async () => 'conflict');
    frame({ ondeploy, onsave });
    await userEvent.click(screen.getByRole('button', { name: 'Schaltfläche' }));
    await userEvent.click(screen.getByTestId('deploy'));
    expect(ondeploy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('woanders geändert');
  });
});

describe('focusTarget ("Gehe zu" of the deploy overview)', () => {
  it('selects the entity the key path points into, then tells the host it is done', async () => {
    const registry = createBuilderRegistry();
    registry.registerInspector('task', DummyInspector);
    const onfocused = vi.fn();
    frame({ focusTarget: 'tasks.kontrolle', onfocused }, registry);
    await vi.waitFor(() => expect(onfocused).toHaveBeenCalled());
    expect(screen.getByTestId('dummy-inspector').textContent).toBe('task:kontrolle');
  });
});
