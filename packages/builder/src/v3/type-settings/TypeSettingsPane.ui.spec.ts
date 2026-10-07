// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTypeSettingsPane } from './register';
import { privateState, visibleRoles } from './ops';
import '../task/shims.testing';

afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function frame(over: Record<string, unknown> = {}) {
  const registry = createBuilderRegistry();
  registerTypeSettingsPane(registry);
  const onchange = vi.fn<(doc: Doc) => void>();
  render(BuilderShell, {
    doc: clean(),
    type: 'baum',
    locale: 'de',
    registry,
    onchange,
    links: { icons: '/admin/projects/p/types/baum' },
    ...over,
  });
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] ?? clean();
  return { onchange, last };
}

const gear = (): HTMLElement => screen.getByRole('button', { name: 'Objektart-Einstellungen' });
const pane = (): HTMLElement => screen.getByTestId('type-settings-pane');

describe('the gear (v3 builder toolbar)', () => {
  it('sits after the view switch and opens the Objektart settings in the right pane', async () => {
    frame();
    const toolbar = screen.getByRole('toolbar');
    const views = within(toolbar).getByRole('group', { name: 'Ansicht' });
    expect(views.compareDocumentPosition(gear()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('type-settings-pane')).toBeNull();
    await userEvent.click(gear());
    const inspector = screen.getByTestId('builder-inspector');
    expect(within(inspector).getByRole('heading', { name: 'Objektart-Einstellungen' })).toBeTruthy();
    expect(inspector.contains(pane())).toBe(true);
  });

  it('renames the Objektart in the pane and the toolbar shows the new name', async () => {
    const { last } = frame();
    await userEvent.click(gear());
    const input = within(pane()).getByLabelText('Name der Objektart');
    await userEvent.clear(input);
    await userEvent.type(input, 'Straßenbaum');
    await userEvent.tab();
    expect((screen.getByTestId('type-name') as HTMLInputElement).value).toBe('Straßenbaum');
    expect(JSON.stringify(last().effective().types?.['baum']?.label)).toContain('Straßenbaum');
  });

  it('an empty name is not taken', async () => {
    frame();
    await userEvent.click(gear());
    const input = within(pane()).getByLabelText('Name der Objektart') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input.value).toBe('Baum');
  });

  const wholeType = (see: unknown): Doc =>
    clean().apply({ kind: 'set', path: 'types.baum.permissions.see', value: see }).doc;

  it('"Sichtbar für Rollen" is the matrix op: a role picked is written to permissions.see', async () => {
    const { last } = frame({ doc: wholeType('$all') });
    await userEvent.click(gear());
    const see = within(within(pane()).getByTestId('type-visible'));
    await userEvent.click(see.getAllByRole('button')[0] as HTMLButtonElement);
    await userEvent.click(screen.getByRole('option', { name: /Baumkontrolle/ }));
    expect(visibleRoles(last().effective(), 'baum')).toContain('kontrolle');
  });

  it('a role made in the picker joins the draft and is picked (v3 onCreateRole)', async () => {
    const { last } = frame({ doc: wholeType('$all') });
    await userEvent.click(gear());
    const see = within(within(pane()).getByTestId('type-visible'));
    await userEvent.click(see.getAllByRole('button')[0] as HTMLButtonElement);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Suchen …' }), 'Gärtner Team');
    await userEvent.click(screen.getByRole('button', { name: /„Gärtner Team“ erstellen/ }));
    expect(last().effective().roles?.['gaertner_team']).toBeDefined();
    expect(visibleRoles(last().effective(), 'baum')).toContain('gaertner_team');
    expect(within(pane()).getByRole('status').textContent).toContain('Gärtner Team');
  });

  it('a per-property audience is not edited here; the pane says where it is set', async () => {
    frame();
    await userEvent.click(gear());
    expect(within(pane()).getByTestId('type-visible').textContent).toContain('Berechtigungen');
  });

  it('"Private Einträge" switches the matrix op (visible_when)', async () => {
    const { last } = frame();
    await userEvent.click(gear());
    expect(privateState(clean().effective(), 'baum')).toBe('off');
    const box = within(pane()).getByRole('checkbox', { name: /Private Einträge/ });
    await userEvent.click(box);
    expect(privateState(last().effective(), 'baum')).toBe('on');
    await userEvent.click(box);
    expect(privateState(last().effective(), 'baum')).toBe('off');
  });

  it('"Standardfilter & Karten-Symbole" is a link to the place that holds it, not a copy of the editor', async () => {
    frame();
    await userEvent.click(gear());
    const link = within(pane()).getByRole('link', { name: /Standardfilter & Karten-Symbole/ });
    expect(link.getAttribute('href')).toBe('/admin/projects/p/types/baum');
  });

  it('without a link the entry is not shown', async () => {
    frame({ links: {} });
    await userEvent.click(gear());
    expect(within(pane()).queryByRole('link')).toBeNull();
  });

  it('English labels in an English admin', async () => {
    frame({ locale: 'en' });
    await userEvent.click(screen.getByRole('button', { name: 'Feature type settings' }));
    expect(within(pane()).getByRole('heading', { name: 'Feature type settings' })).toBeTruthy();
  });
});
