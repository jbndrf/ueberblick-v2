// @vitest-environment jsdom
// WP-380 at phone width: the form editor is the content of the inspector sheet (WP-345), the palettes add by a tap,
// and the card's bar has the buttons a finger needs (up, down, width, page break, remove) without hover.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { registerFieldPane } from '../field/register';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { formOf } from './model';
import { registerFormEditor } from './register';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes('max-width: 767px') || query.includes('pointer: coarse'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.getAnimations ??= () => [];
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('the form editor at 390 px', () => {
  it('opens in the inspector sheet from the task pane; a tap on a tile adds a field; the bar reorders', async () => {
    const registry = createBuilderRegistry();
    registerTaskPane(registry);
    registerFieldPane(registry);
    registerFormEditor(registry);
    let doc: Doc = clean();
    render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange: (d: Doc) => (doc = d) });
    await userEvent.click(screen.getByTestId('open-catalog'));
    await userEvent.click(document.querySelector('[data-path="tasks.kontrolle"]') as HTMLElement);
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Formular' }));
    await userEvent.click(within(sheet).getByTestId('step-0-edit'));
    expect(within(sheet).getByTestId('form-editor')).toBeTruthy();

    await userEvent.click(within(sheet).getByTestId('tile-date'));
    expect(Object.keys(formOf(doc.effective(), 'kontrolle')).at(-1)).toBe('neues_feld');

    const card = document.querySelector('[data-key="neues_feld"]') as HTMLElement;
    for (const id of ['field-remove', 'field-menu']) {
      expect(within(card).getByTestId(id)).toBeTruthy();
    }
    for (const id of ['field-up', 'field-width-left', 'field-page']) {
      expect(within(card).queryByTestId(id)).toBeNull();
    }
    await userEvent.click(within(sheet).getByTestId('page-add'));
    expect(within(sheet).getByTestId('page-tab-1')).toBeTruthy();
    expect(within(sheet).getByTestId('form-editor')).toBeTruthy();
    await userEvent.click(within(sheet).getByTestId('form-close'));
    expect(within(sheet).getByTestId('task-pane')).toBeTruthy();
  });
});
