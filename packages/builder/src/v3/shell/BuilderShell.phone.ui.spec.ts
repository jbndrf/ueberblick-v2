// @vitest-environment jsdom
import { afterEach, beforeAll, vi, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from './BuilderShell.svelte';
import DummyInspector from './DummyInspector.testing.svelte';
import { registerTypeSettingsPane } from '../type-settings/register';
import { createBuilderRegistry } from './registry';

// jsdom has no layout: answer the frame's `(max-width: 767px)` question and the breakpoint helper as a 390 px phone would.
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes('max-width: 767px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function phoneFrame() {
  const registry = createBuilderRegistry();
  registry.registerInspector('task', DummyInspector);
  return render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry });
}

describe('frame at phone width', () => {
  it('shows the canvas alone; catalog and inspector are closed', () => {
    phoneFrame();
    expect(screen.getByTestId('builder-center')).toBeTruthy();
    expect(screen.queryByTestId('builder-catalog')).toBeNull();
    expect(screen.queryByTestId('builder-inspector')).toBeNull();
    expect(screen.getByTestId('open-catalog')).toBeTruthy();
  });

  it('the catalog button opens the catalog as a sheet', async () => {
    phoneFrame();
    await userEvent.click(screen.getByTestId('open-catalog'));
    const catalog = await screen.findByTestId('builder-catalog');
    expect(catalog.closest('[role="dialog"]')).toBeTruthy();
  });

  it('selecting opens the inspector sheet; closing it keeps the selection', async () => {
    phoneFrame();
    await userEvent.click(screen.getByTestId('open-catalog'));
    await userEvent.click(
      await waitFor(() => document.querySelector('[data-path="tasks.kontrolle"]') as HTMLElement),
    );
    // the catalog sheet closes, the inspector sheet opens on the selected task
    expect((await screen.findByTestId('dummy-inspector')).textContent).toBe('task:kontrolle');
    await waitFor(() => expect(screen.queryByTestId('builder-catalog')).toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('builder-inspector')).toBeNull());
    // reopening shows the same selection
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByTestId('open-inspector'));
    expect((await screen.findByTestId('dummy-inspector')).textContent).toBe('task:kontrolle');
  });

  it('the gear opens the Objektart settings as the inspector sheet', async () => {
    const registry = createBuilderRegistry();
    registerTypeSettingsPane(registry);
    render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry });
    await userEvent.click(screen.getByRole('button', { name: 'Objektart-Einstellungen' }));
    const pane = await screen.findByTestId('type-settings-pane');
    expect(pane.closest('[role="dialog"]')).toBeTruthy();
  });

  it('an open sheet has its own Speichern, which saves (v3 toolbar was always in view)', async () => {
    const registry = createBuilderRegistry();
    registerTypeSettingsPane(registry);
    const onsave = vi.fn(async () => 'saved' as const);
    render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry, onsave });
    await userEvent.click(screen.getByRole('button', { name: 'Objektart-Einstellungen' }));
    const pane = await screen.findByTestId('type-settings-pane');
    const sheet = pane.closest('[role="dialog"]') as HTMLElement;
    const save = sheet.querySelector('[data-testid="sheet-save"]') as HTMLElement;
    expect(save.textContent).toContain('Speichern');
    await userEvent.setup({ pointerEventsCheck: 0 }).click(save);
    await waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
  });

  it('the Code view has no sheets and no buttons for them', async () => {
    phoneFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.queryByTestId('open-catalog')).toBeNull();
    expect(screen.queryByTestId('open-inspector')).toBeNull();
  });
});
