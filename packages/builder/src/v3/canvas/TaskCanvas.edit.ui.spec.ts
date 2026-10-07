// @vitest-environment jsdom
// WP-435: editing on the canvas. The gestures that need a real browser (draw, move and delete an arrow, the pointer
// drag) are in the e2e `builder-canvas-edit.spec.ts`; the ops they write are in `edit.spec.ts`. Here: the buttons, the
// right-click menu with the confirm dialog, the keyboard paths and the refusals.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import DummyInspector from '../shell/DummyInspector.testing.svelte';
import { createBuilderRegistry } from '../shell/registry';
import './jsdom.testing';
import { registerCanvas } from './index';

const LOCK = 'lock:\n  - types.baum.properties.stage.options\n';
// system_faellig is the outcome of an automatic action and no longer a button (C-004), so the tool-drop tests
// use a bare task of their own: no form, no steps.
const locked = (): Doc =>
  openProject(musterstadt.templateSrc, musterstadt.overlaySrc).apply({
    kind: 'set',
    path: 'tasks.leer_aufgabe',
    value: { label: { de: 'Leer' }, on: 'baum' },
  }).doc;
const open = (): Doc => openProject(musterstadt.templateSrc.replace(LOCK, ''), musterstadt.overlaySrc);

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
const inspector = () => screen.getByTestId('dummy-inspector').textContent;
/** xyflow measures its nodes and the canvas redraws them once after the mount: wait it out before focusing one. */
const settle = () => new Promise<void>((done) => setTimeout(done, 60));
const keys = (d: Doc) => Object.keys(d.effective().tasks ?? {});

async function menuOf(el: HTMLElement): Promise<string[]> {
  await fireEvent.contextMenu(el, { clientX: 40, clientY: 40 });
  const items = await screen.findAllByRole('menuitem');
  return items.map((i) => i.textContent?.trim() ?? '');
}

describe('"Phase hinzufügen" and "Button hinzufügen"', () => {
  it('the button on the canvas adds a stage and selects it (the catalog chip writes the same op)', async () => {
    const m = mount(open());
    await fireEvent.click(screen.getByTestId('canvas-add-stage'));
    const options = Object.keys(m.last().effective().types?.['baum']?.properties['stage']?.options ?? {});
    expect(options).toHaveLength(5);
    expect(inspector()).toBe(`stage:${options.at(-1)}`);
    await waitFor(() => expect(document.querySelectorAll('[data-stage-node]')).toHaveLength(5));
  });

  it('"Button hinzufügen" at the end of a stage pins the new task to it, and in the global container it has no phase', async () => {
    const m = mount(locked());
    const row = (scope: string) =>
      document.querySelector(`[data-add-task][data-scope="${scope}"]`) as HTMLElement;
    await fireEvent.click(row('massnahme'));
    const staged = keys(m.last()).at(-1) ?? '';
    expect(m.last().effective().tasks?.[staged]?.when).toBe("self.stage == 'massnahme'");
    expect(inspector()).toBe(`task:${staged}`);
    await waitFor(() => expect(stage('massnahme').querySelectorAll('[data-task-id]')).toHaveLength(2));
    await fireEvent.click(row(''));
    const global = keys(m.last()).at(-1) ?? '';
    expect(global).not.toBe(staged);
    expect(m.last().effective().tasks?.[global]?.when).toBeUndefined();
    await waitFor(() =>
      expect(document.querySelector(`[data-global-container] [data-task-id="${global}"]`)).toBeTruthy(),
    );
  });
});

describe('the right-click menu', () => {
  it('a task button: Schlüssel kopieren, Ausblenden (a template task is hidden, WP-454); it asks first and names what it leaves dangling', async () => {
    const m = mount(locked());
    expect(await menuOf(task('massnahme_anlegen'))).toEqual(['Schlüssel kopieren', 'Ausblenden']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Ausblenden' }));
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('Aufgabe „Maßnahme anlegen“ ausblenden?');
    expect(dialog.textContent).toContain('Diese automatischen Aktionen führen die Aufgabe aus');
    expect(dialog.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(m.last()).toBeUndefined();
    await fireEvent.click(screen.getByTestId('confirm-delete-action'));
    expect(keys(m.last())).not.toContain('massnahme_anlegen');
    await waitFor(() => expect(task('massnahme_anlegen')).toBeNull());
  });

  it('Abbrechen leaves the task', async () => {
    const m = mount(locked());
    await menuOf(task('verschieben'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Ausblenden' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    expect(m.last()).toBeUndefined();
    expect(task('verschieben')).toBeTruthy();
  });

  it('a stage header: the template locks its phases, so "Ausblenden" is switched off', async () => {
    const m = mount(locked());
    expect(await menuOf(stage('kontrolliert'))).toEqual(['Schlüssel kopieren', 'Ausblenden']);
    expect((screen.getByRole('menuitem', { name: 'Ausblenden' }) as HTMLButtonElement).disabled).toBe(true);
    expect(m.last()).toBeUndefined();
    expect(stage('kontrolliert')).toBeTruthy();
  });

  it('an unlocked stage is deleted after the confirm', async () => {
    const m = mount(open());
    await menuOf(stage('kontrolliert'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Ausblenden' }));
    await fireEvent.click(await screen.findByTestId('confirm-delete-action'));
    const options = m.last().effective().types?.['baum']?.properties['stage']?.options ?? {};
    expect(Object.keys(options)).not.toContain('kontrolliert');
    await waitFor(() => expect(stage('kontrolliert')).toBeNull());
  });

  it('a rule: Schlüssel kopieren, Ausblenden; an entry marker: only the delete (as in v3)', async () => {
    const m = mount(locked());
    expect(
      await menuOf(
        document.querySelector('[data-rule-key="massnahme_anlegen.massnahme_bei_schaden"]') as HTMLElement,
      ),
    ).toEqual(['Schlüssel kopieren', 'Ausblenden']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Ausblenden' }));
    await fireEvent.click(await screen.findByTestId('confirm-delete-action'));
    expect(
      m.last().effective().tasks?.['massnahme_anlegen']?.auto?.['massnahme_bei_schaden'],
    ).toBeUndefined();
    await waitFor(() =>
      expect(document.querySelector('[data-rule-key="massnahme_anlegen.massnahme_bei_schaden"]')).toBeNull(),
    );
    expect(await menuOf(document.querySelector('.entry-node') as HTMLElement)).toEqual(['Ausblenden']);
  });

  it('a tool icon: Aus Aufgabe entfernen takes the step out of the task', async () => {
    const m = mount(locked());
    await settle();
    const tool = task('baum_bearbeiten').querySelector('[data-tool-index="0"]') as HTMLElement;
    expect(await menuOf(tool)).toEqual(['Aus Aufgabe entfernen']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Aus Aufgabe entfernen' }));
    expect(m.last().effective().tasks?.['baum_bearbeiten']?.steps).toEqual([
      expect.objectContaining({ kind: 'location' }),
    ]);
  });
});

describe('keyboard paths', () => {
  it('Alt+ArrowDown / Alt+ArrowUp on a focused button move it one place; the file order changes', async () => {
    const m = mount(locked());
    await settle();
    const scope = () =>
      [...document.querySelectorAll('[data-global-container] [data-task-id]')].map((e) =>
        e.getAttribute('data-task-id'),
      );
    const before = scope();
    const first = before[0] ?? '';
    task(first).focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(
      keys(m.last())
        .filter((k) => before.includes(k))
        .slice(0, 2),
    ).toEqual([before[1], first]);
    await waitFor(() => expect(scope().slice(0, 2)).toEqual([before[1], first]));
    task(first).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(scope()).toEqual(before));
  });

  it('Space on a tool icon picks it up, Enter on another button drops it there, Escape lets it go', async () => {
    const m = mount(locked());
    await settle();
    const tool = task('baum_bearbeiten').querySelector('[data-tool-index="0"]') as HTMLElement;
    tool.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByTestId('canvas-note').textContent).toContain('aufgenommen');
    task('leer_aufgabe').focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('canvas-note')).toBeNull();
    expect(m.last()).toBeUndefined();
    tool.focus();
    await userEvent.keyboard(' ');
    task('leer_aufgabe').focus();
    await userEvent.keyboard('{Enter}');
    const doc = m.last();
    expect(doc.effective().tasks?.['leer_aufgabe']?.steps).toEqual([
      expect.objectContaining({ kind: 'quick_edit' }),
    ]);
    expect(doc.effective().tasks?.['baum_bearbeiten']?.steps).toEqual([
      expect.objectContaining({ kind: 'location' }),
    ]);
  });

  it('with Alt, Enter copies: the source keeps its step', async () => {
    const m = mount(locked());
    await settle();
    const tool = task('baum_bearbeiten').querySelector('[data-tool-index="1"]') as HTMLElement;
    tool.focus();
    await userEvent.keyboard(' ');
    task('leer_aufgabe').focus();
    await userEvent.keyboard('{Alt>}{Enter}{/Alt}');
    expect(m.last().effective().tasks?.['baum_bearbeiten']?.steps).toHaveLength(2);
    expect(m.last().effective().tasks?.['leer_aufgabe']?.steps).toEqual([
      expect.objectContaining({ kind: 'location' }),
    ]);
  });

  it('a refused drop says why and writes nothing (the target already has a form)', async () => {
    const m = mount(locked());
    await settle();
    const tool = task('verschieben').querySelector('[data-tool-index="0"]') as HTMLElement;
    tool.focus();
    await userEvent.keyboard(' ');
    task('befund_ergaenzen').focus();
    await userEvent.keyboard('{Enter}');
    expect(m.last()).toBeUndefined();
    expect(screen.getByTestId('canvas-note').textContent).toContain('schon ein Formular');
  });
});

describe('a catalog chip dropped on the canvas', () => {
  const drop = (target: Element, payload: unknown, mime: string) =>
    fireEvent.drop(target, {
      dataTransfer: { getData: (t: string) => (t === mime ? JSON.stringify(payload) : ''), types: [mime] },
    });

  it('a Phase chip makes a stage; a Formular chip on a phase makes a button with a form there', async () => {
    const m = mount(open());
    const root = screen.getByTestId('builder-canvas');
    await drop(root, { kind: 'node', node: 'stage' }, 'application/ueberblick-node');
    expect(
      Object.keys(m.last().effective().types?.['baum']?.properties['stage']?.options ?? {}),
    ).toHaveLength(5);
    await drop(stage('massnahme'), { kind: 'task', task: 'form' }, 'application/ueberblick-tool');
    const added = keys(m.last()).at(-1) ?? '';
    expect(m.last().effective().tasks?.[added]).toMatchObject({
      when: "self.stage == 'massnahme'",
      form: {},
    });
  });

  it('a Formular chip on a button without a form adds the step; on one with a form it says so', async () => {
    const m = mount(locked());
    await drop(task('leer_aufgabe'), { kind: 'task', task: 'form' }, 'application/ueberblick-tool');
    expect(m.last().effective().tasks?.['leer_aufgabe']?.form).toEqual({});
    await drop(task('befund_ergaenzen'), { kind: 'task', task: 'form' }, 'application/ueberblick-tool');
    expect(screen.getByTestId('canvas-note').textContent).toContain('schon ein Formular');
  });
});

describe('a template lock', () => {
  it('a locked task has "Ausblenden" switched off and shows the lock, and the task stays', async () => {
    const lockedTask = openProject(
      musterstadt.templateSrc.replace(LOCK, `${LOCK}  - tasks.verschieben\n`),
      musterstadt.overlaySrc,
    );
    const m = mount(lockedTask);
    await menuOf(task('verschieben'));
    expect((screen.getByRole('menuitem', { name: 'Ausblenden' }) as HTMLButtonElement).disabled).toBe(true);
    expect(task('verschieben').querySelector('[data-testid="provenance-lock"]')).not.toBeNull();
    expect(m.last()).toBeUndefined();
    expect(task('verschieben')).toBeTruthy();
  });
});
