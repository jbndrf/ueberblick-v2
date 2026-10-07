// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import DummyInspector from '../shell/DummyInspector.testing.svelte';
import { createBuilderRegistry } from '../shell/registry';
import './jsdom.testing';
import { registerCanvas } from './index';

const LOCK = 'lock:\n  - types.baum.properties.stage.options\n';
const locked = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
/** The template author did not lock the stage options, so the overlay may rename them. */
const open = (): Doc => {
  expect(musterstadt.templateSrc).toContain(LOCK);
  return openProject(musterstadt.templateSrc.replace(LOCK, ''), musterstadt.overlaySrc);
};

function mount(doc: Doc, props: Record<string, unknown> = {}) {
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  registry.registerInspector('stage', DummyInspector);
  registry.registerInspector('task', DummyInspector);
  registry.registerInspector('rule', DummyInspector);
  registry.registerInspector('none', DummyInspector);
  return render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, ...props });
}
const stage = (key: string) => document.querySelector(`[data-stage-node="${key}"]`) as HTMLElement;
/** jsdom: user-event's mousedown has no `view`, which xyflow's d3-zoom needs; a click event is what the canvas listens to. */
const click = (el: Element | null) => fireEvent.click(el as Element);
const typeInto = async (input: HTMLInputElement, text: string, key = 'Enter') => {
  await fireEvent.input(input, { target: { value: text } });
  await fireEvent.keyDown(input, { key });
};
const inspector = () => screen.getByTestId('dummy-inspector').textContent;

describe('canvas draws the process of the baumkataster', () => {
  it('shows the stage cards with their type, the global container, the entry marker and the rules', () => {
    mount(locked());
    expect(screen.getByTestId('builder-canvas')).toBeTruthy();
    expect(
      [...document.querySelectorAll('[data-stage-node]')].map((e) => e.getAttribute('data-stage-node')),
    ).toEqual(['erfasst', 'kontrolliert', 'massnahme', 'erledigt']);
    expect(stage('erfasst').classList.contains('start')).toBe(true);
    expect(stage('erledigt').classList.contains('end')).toBe(true);
    expect(stage('erfasst').querySelector('[title="Startphase"]')).toBeTruthy();
    expect(stage('erledigt').querySelector('[title="Endphase"]')).toBeTruthy();
    expect(document.querySelector('[data-global-container]')?.textContent).toContain('Global');
    expect(document.querySelectorAll('[data-rule-key]').length).toBe(2);
    expect(document.querySelector('.entry-node')?.textContent).toContain('Baum erfassen');
  });

  it('an automatic action without a timing says "Wenn: <Bedingung>" on its node (WP-438)', () => {
    const edited = locked().apply({
      kind: 'set',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.when',
      value: 'self.hoehe_m > 3',
    }).doc;
    const doc = edited.apply({
      kind: 'hide',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after',
    }).doc;
    mount(doc);
    const node = document.querySelector('[data-rule-key="massnahme_anlegen.massnahme_bei_schaden"]');
    expect(node?.textContent).toContain('Wenn: self.hoehe_m > 3');
    expect(node?.textContent).not.toContain('Zeitplan');
  });

  it('shows the task buttons on their stage and in the global container, with tools and an exit dot', () => {
    mount(locked());
    const onStage = stage('massnahme').querySelectorAll('[data-task-id]');
    expect([...onStage].map((e) => e.getAttribute('data-task-id'))).toEqual(['massnahme_anlegen']);
    const kontrolle = document.querySelector(
      '[data-global-container] [data-task-id="kontrolle"]',
    ) as HTMLElement;
    expect(kontrolle.textContent).toContain('Regelkontrolle');
    expect(kontrolle.querySelector('[title="Formular"]')).toBeTruthy();
    expect(kontrolle.querySelector('.svelte-flow__handle.source')).toBeTruthy();
    expect(kontrolle.querySelector('.exit-dot.transition')).toBeTruthy();
    expect(document.querySelector('[data-task-id="befund_ergaenzen"] .no-tools')).toBeNull();
  });

  it('shows no note for a type without stages, and still its tasks without a stage', () => {
    mount(locked(), { type: 'flaeche' });
    expect(document.querySelectorAll('[data-stage-node]').length).toBe(0);
    expect(
      document.querySelector('[data-global-container] [data-task-id="flaeche_bearbeiten"]'),
    ).toBeTruthy();
  });
});

describe('selection', () => {
  it('clicking a stage, a task button, a rule or an entry marker selects it for the right pane', async () => {
    mount(locked());
    await click(stage('kontrolliert'));
    expect(inspector()).toBe('stage:kontrolliert');
    await click(document.querySelector('[data-task-id="kontrolle"]') as HTMLElement);
    expect(inspector()).toBe('task:kontrolle');
    await click(
      document.querySelector('[data-rule-key="massnahme_anlegen.massnahme_bei_schaden"]') as HTMLElement,
    );
    expect(inspector()).toBe('rule:massnahme_anlegen.massnahme_bei_schaden');
    await click(document.querySelector('.entry-node') as HTMLElement);
    expect(inspector()).toBe('task:erfassen');
  });

  it('a task button click does not select its stage; the selected node is marked', async () => {
    mount(locked());
    await click(document.querySelector('[data-task-id="massnahme_anlegen"]') as HTMLElement);
    expect(inspector()).toBe('task:massnahme_anlegen');
    expect(document.querySelector('[data-task-id="massnahme_anlegen"]')?.classList.contains('selected')).toBe(
      true,
    );
    expect(stage('massnahme').classList.contains('selected')).toBe(false);
  });

  it('keyboard: Enter on a focused stage selects it', async () => {
    mount(locked());
    stage('erfasst').focus();
    await userEvent.keyboard('{Enter}');
    expect(inspector()).toBe('stage:erfasst');
  });

  it('clicking the background clears the selection', async () => {
    mount(locked());
    await click(stage('erfasst'));
    await fireEvent.click(document.querySelector('.svelte-flow__pane') as HTMLElement);
    expect(inspector()).toBe('none:');
  });
});

describe('inline rename writes the Doc', () => {
  it('a click on the stage title edits it; Enter changes the label, keeps the key, and Speichern persists it', async () => {
    const onchange = vi.fn();
    const onsave = vi.fn<(overlay: string) => Promise<'saved'>>(async () => 'saved');
    mount(open(), { onchange, onsave });
    await click(stage('kontrolliert').querySelector('.stage-title') as HTMLElement);
    const input = stage('kontrolliert').querySelector('input') as HTMLInputElement;
    await typeInto(input, 'Geprüft');
    const doc = onchange.mock.calls.at(-1)?.[0] as Doc;
    const label = doc.effective().types?.['baum']?.properties['stage']?.options?.['kontrolliert'];
    expect(label).toMatchObject({ de: 'Geprüft' });
    // other languages stay (the template carries an en label)
    expect(Object.keys(label ?? {})).toContain('en');
    expect(stage('kontrolliert').textContent).toContain('Geprüft');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(String(onsave.mock.calls[0]?.[0])).toContain('Geprüft');
  });

  it('Escape cancels, an empty text reverts', async () => {
    const onchange = vi.fn();
    mount(open(), { onchange });
    await click(stage('kontrolliert').querySelector('.stage-title') as HTMLElement);
    await typeInto(stage('kontrolliert').querySelector('input') as HTMLInputElement, 'x', 'Escape');
    expect(stage('kontrolliert').textContent).toContain('Kontrolliert');
    await click(stage('kontrolliert').querySelector('.stage-title') as HTMLElement);
    await typeInto(stage('kontrolliert').querySelector('input') as HTMLInputElement, '');
    expect(onchange).not.toHaveBeenCalled();
    expect(stage('kontrolliert').textContent).toContain('Kontrolliert');
  });

  it('a double-click on a task button label edits the task label, and the click selects the task', async () => {
    const onchange = vi.fn();
    mount(locked(), { onchange });
    const label = document.querySelector('[data-task-id="befund_ergaenzen"] .toolbar-label') as HTMLElement;
    await fireEvent.dblClick(label);
    const input = document.querySelector('[data-task-id="befund_ergaenzen"] input') as HTMLInputElement;
    await typeInto(input, 'Befund nachtragen');
    const doc = onchange.mock.calls.at(-1)?.[0] as Doc;
    expect(doc.effective().tasks?.['befund_ergaenzen']?.label).toMatchObject({
      de: 'Befund nachtragen',
      en: 'Add finding',
    });
    expect(document.querySelector('[data-task-id="befund_ergaenzen"]')?.textContent).toContain(
      'Befund nachtragen',
    );
  });

  it('F2 on a focused task button starts the rename (keyboard path for the double-click)', async () => {
    mount(locked());
    (document.querySelector('[data-task-id="befund_ergaenzen"]') as HTMLElement).focus();
    await userEvent.keyboard('{F2}');
    expect(document.querySelector('[data-task-id="befund_ergaenzen"] input')).toBeTruthy();
  });

  it('a locked stage is refused by the document: the frame says so and the label stays', async () => {
    mount(locked());
    await click(stage('kontrolliert').querySelector('.stage-title') as HTMLElement);
    const input = stage('kontrolliert').querySelector('input') as HTMLInputElement;
    await typeInto(input, 'Anders');
    expect(screen.getByRole('alert').textContent).toContain('Von der Vorlage gesperrt');
    expect(stage('kontrolliert').textContent).toContain('Kontrolliert');
  });
});

describe('the canvas goes through Paraglide', () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.svelte'));
  it.each(files)('%s has no literal user-visible text', (file) => {
    const code = readFileSync(join(dir, file), 'utf8');
    let markup = code.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    for (let prev = ''; prev !== markup;) {
      prev = markup;
      markup = markup.replace(/\{[^{}]*\}/g, '');
    }
    const text = [...markup.matchAll(/>([^<>]+)</g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((t) => /\p{L}/u.test(t));
    expect(text).toEqual([]);
    const attrs = [...markup.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)];
    expect(attrs.map((m) => m[1])).toEqual([]);
  });
});
