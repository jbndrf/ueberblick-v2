// @vitest-environment jsdom
// WP-379: the Code view and the inspector's YAML toggle inside the builder frame, one test per acceptance box.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { parse, stringify } from 'yaml';
import '../task/shims.testing';
import { openProject, type Doc } from '../../doc';
import { drop, get, put, type Tree } from '../../doc/tree.testing';
import { musterstadt } from '../../testing/golden';
import { registerFieldPane } from '../field/register';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerCodeView, registerEntityYaml } from './index';

afterEach(cleanup);
// jsdom has no layout: CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

type Save = (overlay: string) => Promise<'saved'>;
const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const applyButton = () => screen.getByTestId('code-apply') as HTMLButtonElement;

/** A real edit is a text change: the YAML of the changed data replaces the whole document. */
function replaceAll(view: EditorView, data: Tree): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: stringify(data) } });
}
const dataOf = (view: EditorView): Tree => parse(view.state.doc.toString()) as Tree;
const editorView = async (container: HTMLElement = document.body): Promise<EditorView> => {
  await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
  return EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement) as EditorView;
};

async function openCode(onsave?: Save) {
  const registry = createBuilderRegistry();
  registerCodeView(registry);
  const onchange = vi.fn();
  const r = render(BuilderShell, {
    doc: clean(),
    type: 'baum',
    locale: 'de',
    registry,
    view: 'code',
    onchange,
    ...(onsave === undefined ? {} : { onsave }),
  });
  const view = await editorView(r.container);
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  return { view, onchange, last, container: r.container };
}

describe('?view=code shows the effective YAML with provenance', () => {
  it('the Objektart as YAML in the template file shape, with Kopieren, Neu laden, Übernehmen', async () => {
    const h = await openCode();
    const data = dataOf(h.view);
    expect(screen.getByTestId('code-view')).toBeTruthy();
    expect(Object.keys(data)).toEqual(['types', 'tasks']);
    expect(Object.keys(data['types'] as Tree)).toEqual(['baum']);
    expect(get(data, 'tasks.kontrolle.label.de')).toBe('Regelkontrolle');
    expect(screen.getByTestId('code-copy')).toBeTruthy();
    expect(screen.getByTestId('code-reload')).toBeTruthy();
    expect(applyButton().disabled).toBe(true);
  });

  it('marks what the overlay changed in the margin, and explains the marks', async () => {
    const h = await openCode();
    const kinds = [...h.container.querySelectorAll('[data-provenance]')].map(
      (e) => (e as HTMLElement).dataset['provenance'],
    );
    // (jsdom has no layout, so only the first lines are drawn; every line's provenance is proven in doc/type-yaml.spec.ts)
    expect(kinds).toContain('changed');
    expect(screen.getByRole('list', { name: 'Herkunft' }).textContent).toContain('Von Ihnen geändert');
  });
});

describe('editing', () => {
  it('Übernehmen turns an edited value into an overlay op; the frame then saves the overlay', async () => {
    const onsave = vi.fn<Save>(async () => 'saved');
    const h = await openCode(onsave);
    const data = dataOf(h.view);
    put(data, 'tasks.kontrolle.label.de', 'Prüfung');
    replaceAll(h.view, data);
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    await userEvent.click(applyButton());
    expect(screen.getByTestId('code-message').textContent).toContain('Übernommen');
    expect(h.last().dirty).toBe(true);
    expect(h.last().effective().tasks?.['kontrolle']?.label).toMatchObject({ de: 'Prüfung' });
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
    expect(onsave.mock.calls[0]?.[0]).toContain('Prüfung');
  });

  it('a locked path gives a problem on its line and changes nothing', async () => {
    const h = await openCode();
    const data = dataOf(h.view);
    put(data, 'types.baum.properties.stage.options.erfasst', 'Neu');
    replaceAll(h.view, data);
    await waitFor(() => expect(screen.getByTestId('code-problems')).toBeTruthy());
    expect(screen.getByTestId('code-problems').textContent).toMatch(/Zeile \d+/);
    await userEvent.click(applyButton());
    expect(h.onchange).not.toHaveBeenCalled();
  });

  it('a parse error shows inline (problem list with its line) and saves nothing', async () => {
    const onsave = vi.fn<Save>(async () => 'saved');
    const h = await openCode(onsave);
    h.view.dispatch({ changes: { from: 0, insert: 'broken: [unclosed\n' } });
    await waitFor(() => expect(screen.getByTestId('code-problems').textContent).toMatch(/Zeile \d+/));
    await userEvent.click(applyButton());
    expect(h.onchange).not.toHaveBeenCalled();
    expect(onsave).not.toHaveBeenCalled();
  });

  it('Neu laden puts the document back', async () => {
    const h = await openCode();
    const before = h.view.state.doc.toString();
    h.view.dispatch({ changes: { from: 0, insert: '# x\n' } });
    await userEvent.click(screen.getByTestId('code-reload'));
    await waitFor(() => expect(h.view.state.doc.toString()).toBe(before));
  });

  it('removing a template task hides it, adding one adds it', async () => {
    const h = await openCode();
    const data = dataOf(h.view);
    drop(data, 'tasks.befund_ergaenzen');
    put(data, 'tasks.neu', { label: { de: 'Neu' }, on: 'baum', form: { befund: {} } });
    replaceAll(h.view, data);
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    await userEvent.click(applyButton());
    expect(h.last().overlay().hide).toContain('tasks.befund_ergaenzen');
    expect(h.last().effective().tasks?.['neu']).toBeDefined();
  });
});

describe('the inspector YAML toggle (EntityYamlView) round-trips', () => {
  it('a field: Formular | YAML, edit the label, Übernehmen, back to the form', async () => {
    const registry = createBuilderRegistry();
    registerFieldPane(registry);
    registerCodeView(registry);
    registerEntityYaml(registry);
    const onchange = vi.fn();
    render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry, onchange });
    await userEvent.click(
      document.querySelector('[data-path="types.baum.properties.befund"]') as HTMLElement,
    );
    expect(screen.getByTestId('mode-form').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByTestId('mode-yaml'));
    const view = await editorView();
    const data = dataOf(view);
    expect(data['type']).toBe('text');
    put(data, 'label.de', 'Befund neu');
    replaceAll(view, data);
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    await userEvent.click(applyButton());
    const doc = onchange.mock.calls.at(-1)?.[0] as Doc;
    expect(doc.effective().types?.['baum']?.properties['befund']?.label).toMatchObject({ de: 'Befund neu' });
    await userEvent.click(screen.getByTestId('mode-form'));
    expect(screen.queryByTestId('entity-yaml')).toBeNull();
  });

  it('order does not matter: a pane registered after registerEntityYaml still has the toggle', async () => {
    const registry = createBuilderRegistry();
    registerEntityYaml(registry);
    registerFieldPane(registry);
    render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry });
    await userEvent.click(
      document.querySelector('[data-path="types.baum.properties.befund"]') as HTMLElement,
    );
    expect(screen.getByTestId('mode-form').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('field-pane')).toBeTruthy();
    await userEvent.click(screen.getByTestId('mode-yaml'));
    expect(screen.getByTestId('entity-yaml')).toBeTruthy();
  });

  it('a kind with no pane (a rule) shows its YAML alone, without a toggle, and round-trips', async () => {
    const registry = createBuilderRegistry();
    registerEntityYaml(registry);
    const onchange = vi.fn();
    const r = render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry, onchange });
    await userEvent.click(
      r.container.querySelector(
        '[data-path="tasks.massnahme_anlegen.auto.massnahme_bei_schaden"]',
      ) as HTMLElement,
    );
    expect(screen.queryByTestId('mode-yaml')).toBeNull();
    const view = await editorView();
    expect(dataOf(view)['after']).toBe('kontrolle');
  });

  it('a rule (no form pane registered): its YAML stands alone and round-trips', async () => {
    const registry = createBuilderRegistry();
    registerCodeView(registry);
    registerEntityYaml(registry);
    const onchange = vi.fn();
    const r = render(BuilderShell, { doc: clean(), type: 'baum', locale: 'de', registry, onchange });
    await userEvent.click(
      r.container.querySelector(
        '[data-path="tasks.massnahme_anlegen.auto.massnahme_bei_schaden"]',
      ) as HTMLElement,
    );
    const view = await editorView();
    const data = dataOf(view);
    expect(data['after']).toBe('kontrolle');
    put(data, 'when', "self.vitalitaet >= 'v4'");
    replaceAll(view, data);
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    await userEvent.click(applyButton());
    const doc = onchange.mock.calls.at(-1)?.[0] as Doc;
    expect(doc.effective().tasks?.['massnahme_anlegen']?.auto?.['massnahme_bei_schaden']?.when).toBe(
      "self.vitalitaet >= 'v4'",
    );
  });
});
