// @vitest-environment jsdom
// WP-480: the stage pane shows the provenance mark, the reset and the hide, as the canvas node and the rule pane do.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { registerCanvas } from '../canvas';
import '../canvas/jsdom.testing';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerStagePane } from './index';

afterEach(cleanup);

const LOCK = 'lock:\n  - types.baum.properties.stage.options\n';
const STAGE = 'types.baum.properties.stage.options.massnahme';
const free = (): Doc => openProject(musterstadt.templateSrc.replace(LOCK, ''), musterstadt.overlaySrc);

async function open(doc: Doc) {
  const onchange = vi.fn<(d: Doc) => void>();
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  registerStagePane(registry);
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  await vi.waitFor(() => expect(document.querySelector('[data-stage-node="massnahme"]')).toBeTruthy());
  await fireEvent.click(document.querySelector('[data-stage-node="massnahme"]') as HTMLElement);
  await screen.findByTestId('stage-pane');
  return { last: () => onchange.mock.calls.at(-1)?.[0] as Doc };
}
const pane = () => screen.getByTestId('stage-provenance');
const kind = () => pane().querySelector('[data-testid="provenance-mark"]')?.getAttribute('data-provenance');

describe('provenance on the stage pane (WP-480)', () => {
  it('a template stage shows its mark, "Ausblenden" in place of delete, and hides it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const h = await open(free());
    expect(kind()).toBe('template');
    expect(screen.queryByTestId('stage-reset')).toBeNull();
    expect(screen.getByTestId('stage-delete').getAttribute('title')).toBe('Ausblenden');
    await user.click(screen.getByTestId('stage-delete'));
    expect(screen.getByTestId('confirm-delete').textContent).toContain('ausblenden?');
    await user.click(screen.getByTestId('confirm-delete-action'));
    expect(h.last().overlay().hide).toContain(STAGE);
  });

  it('a changed stage offers "Auf Vorlage zurücksetzen", and the reset puts it back', async () => {
    const r = free().apply({ kind: 'set', path: `${STAGE}.de`, value: 'Anders' });
    if (r.refused !== undefined) throw new Error(r.refused.message);
    const h = await open(r.doc);
    expect(kind()).toBe('changed');
    await userEvent.click(screen.getByTestId('stage-reset'));
    expect(h.last().provenance(STAGE)).toBe('template');
    expect(screen.queryByTestId('stage-reset')).toBeNull();
  });

  it('a stage the template locks shows the lock and cannot be hidden or reset', async () => {
    await open(openProject(musterstadt.templateSrc, musterstadt.overlaySrc));
    expect(pane().querySelector('[data-testid="provenance-lock"]')).not.toBeNull();
    expect((screen.getByTestId('stage-delete') as HTMLButtonElement).disabled).toBe(true);
  });
});
