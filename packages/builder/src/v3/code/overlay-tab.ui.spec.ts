// @vitest-environment jsdom
// WP-440: the Code view's second tab "Anpassungen" inside the builder frame.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../task/shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerCodeView } from './index';

afterEach(cleanup);
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const EMPTY_TEMPLATE = 'schema: ueberblick/1\ntemplate: { key: leer, version: 1.0.0 }\n';
const EMPTY_OVERLAY = 'schema: ueberblick/1\nextends: leer@1\n';

function open(doc: Doc, type = 'baum') {
  const registry = createBuilderRegistry();
  registerCodeView(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type, locale: 'de', registry, view: 'code', onchange });
}
const muster = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('Anpassungen', () => {
  it("shows exactly this Objektart's overlay entries, read-only, after a rename", async () => {
    const doc = muster().apply({
      kind: 'set',
      path: 'types.baum.properties.vitalitaet.label',
      value: { de: 'Kronenzustand' },
    }).doc;
    open(doc);
    await userEvent.click(await screen.findByRole('tab', { name: 'Anpassungen' }));
    const text = screen.getByTestId('overlay-text') as HTMLTextAreaElement;
    expect(text.readOnly).toBe(true);
    expect(text.value).toContain('types.baum.properties.vitalitaet.label');
    expect(text.value).toContain('Kronenzustand');
    expect(text.value).toContain('types.baum.properties.patenschaft');
    expect(text.value).not.toContain('paten:');
    expect(screen.getByTestId('code-view').closest('[hidden]')).not.toBeNull();
  });

  it('Kopieren puts the overlay text on the clipboard', async () => {
    open(muster());
    await userEvent.click(await screen.findByRole('tab', { name: 'Anpassungen' }));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByTestId('overlay-copy'));
    expect(writeText).toHaveBeenCalledWith((screen.getByTestId('overlay-text') as HTMLTextAreaElement).value);
    await waitFor(() => expect(screen.getByTestId('overlay-copy').textContent).toContain('Kopiert'));
  });

  it('says so when the project changed nothing on this Objektart', async () => {
    open(muster(), 'flaeche');
    await userEvent.click(await screen.findByRole('tab', { name: 'Anpassungen' }));
    expect(screen.getByTestId('overlay-empty').textContent).toBe(
      'Keine Anpassungen – alles kommt aus der Vorlage.',
    );
  });

  it('typed text of the Code tab survives a look at the overlay', async () => {
    open(muster());
    await userEvent.click(await screen.findByRole('tab', { name: 'Anpassungen' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(screen.getByTestId('code-view').closest('[hidden]')).toBeNull();
  });

  it('a project on an empty template has no tab', async () => {
    const doc = openProject(EMPTY_TEMPLATE, EMPTY_OVERLAY).apply({
      kind: 'add',
      path: 'types.baum',
      value: { label: { de: 'Baum' }, properties: {} },
    }).doc;
    open(doc);
    await waitFor(() => expect(screen.getByTestId('code-view')).toBeTruthy());
    expect(screen.queryByRole('tab', { name: 'Anpassungen' })).toBeNull();
  });
});
