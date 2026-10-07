// @vitest-environment jsdom
// C-004 step 1 (owner, 2026-10-05): one action = a condition and an outcome, carried out by people or automatically.
// An automatic action owns its outcome (its own task is never a button); the catalog has one list "Aktionen" with a
// filter; the task pane and the automatic action's pane share the sections Bedingung and Ergebnis.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../task/shims.testing';
import type { Doc } from '../../doc';
import { goldenDoc } from '../../lenses/process/fixtures';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { registerRulePane } from '../rule';
import './jsdom.testing';
import { registerCanvas } from './index';

afterEach(cleanup);

const meldung = (): Doc => goldenDoc('maengelmelder', '1.0.0');

function mount(doc: Doc = meldung()) {
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  registerTaskPane(registry);
  registerRulePane(registry);
  const onchange = vi.fn<(d: Doc) => void>();
  render(BuilderShell, { doc, type: 'meldung', locale: 'de', registry, onchange });
  return { last: () => onchange.mock.calls.at(-1)?.[0] as Doc };
}
const button = (key: string) => document.querySelector(`[data-task-id="${key}"]`);
const tab = (name: string) => screen.getByRole('tab', { name });
const catalog = () => within(screen.getByTestId('builder-catalog'));

describe('an automatic action owns its outcome', () => {
  it('its own task is no button on the canvas, but a person action still is', async () => {
    mount();
    await screen.findByTestId('builder-catalog');
    expect(button('eskalieren')).toBeNull();
    expect(button('benachrichtigen')).toBeNull();
    expect(button('bewerten')).not.toBeNull();
  });

  it('the rule node reads the outcome in one line', () => {
    mount();
    const node = document.querySelector('[data-rule-key="eskalieren.eskalation_nach_frist"]') as HTMLElement;
    const outcome = within(node).getByTestId('rule-outcome');
    expect(outcome.textContent).toBe('Eskaliert → ja · Priorität → Hoch');
    expect(node.textContent).not.toContain('führt aus');
  });

  it('a click on the node opens the pane where that outcome is edited', async () => {
    mount();
    await fireEvent.click(
      document.querySelector('[data-rule-key="eskalieren.eskalation_nach_frist"]') as HTMLElement,
    );
    await userEvent.click(tab('Ergebnis'));
    expect(screen.getByTestId('rule-tab-steps')).toBeTruthy();
    expect(screen.getByTestId('task-tab-outcomes')).toBeTruthy();
  });

  it('a system-only task no single automatic action owns shows the automatic mark', () => {
    const doc = meldung().apply({
      kind: 'set',
      path: 'tasks.nur_system',
      // two automatic actions and no `who`: no single action owns the task, and no person may run it
      value: {
        label: { de: 'Nur System' },
        on: 'meldung',
        auto: {
          a: { elapsed: { from: 'self.gemeldet_am' } },
          b: { elapsed: { from: 'self.gemeldet_am', after: 'days(1)' } },
        },
      },
    }).doc;
    mount(doc);
    const el = button('nur_system') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('title')).toBe('Wird nur automatisch ausgeführt');
    expect(within(el).getByTestId('task-automatic').textContent).toContain('automatisch');
    expect(within(button('bewerten') as HTMLElement).queryByTestId('task-automatic')).toBeNull();
  });
});

describe('one list of actions', () => {
  it('lists person and automatic actions together and never an own task', () => {
    mount();
    const rows = [...screen.getByTestId('catalog-actions').querySelectorAll('[data-path]')];
    const paths = rows.map((r) => r.getAttribute('data-path'));
    expect(paths).toContain('tasks.bewerten');
    expect(paths).toContain('tasks.eskalieren.auto.eskalation_nach_frist');
    expect(paths).not.toContain('tasks.eskalieren');
    expect(paths).not.toContain('tasks.benachrichtigen');
    expect(catalog().queryByText('Automatisierungen')).toBeNull();
  });

  it('the chips filter: Personen shows people actions, Automatisch the automatic ones', async () => {
    mount();
    const rows = () =>
      [...screen.getByTestId('catalog-actions').querySelectorAll('[data-action]')].map((r) => [
        r.getAttribute('data-path'),
        r.getAttribute('data-action'),
      ]);
    await userEvent.click(screen.getByTestId('catalog-filter-automatic'));
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every(([, kind]) => kind === 'automatic')).toBe(true);
    expect(rows().map(([p]) => p)).toContain('tasks.eskalieren.auto.eskalation_nach_frist');
    await userEvent.click(screen.getByTestId('catalog-filter-people'));
    expect(rows().every(([, kind]) => kind === 'people')).toBe(true);
    expect(rows().map(([p]) => p)).toContain('tasks.bewerten');
    await userEvent.click(screen.getByTestId('catalog-filter-all'));
    expect(new Set(rows().map(([, kind]) => kind))).toEqual(new Set(['people', 'automatic']));
  });

  it('"+ Aktion → Automatisch" adds a task with one automatic action', async () => {
    const m = mount();
    await userEvent.click(catalog().getByRole('button', { name: 'Automatisch' }));
    const file = m.last().effective();
    const [run, task] = Object.entries(file.tasks ?? {}).at(-1) ?? ['', undefined];
    expect(task).toMatchObject({ on: 'meldung' });
    expect(task?.who).toBeUndefined(); // no `who`: only the system runs it
    expect(Object.keys(task?.auto ?? {})).toHaveLength(1);
    expect(button(run)).toBeNull();
  });
});

describe('the same sections for both kinds', () => {
  it('a task has Bedingung and Ergebnis and no Wer tab', async () => {
    mount();
    await userEvent.click(
      document.querySelector('[data-path="tasks.beschreibung_uebersetzen"]') as HTMLElement,
    );
    const names = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(['Bedingung', 'Ergebnis']));
    expect(names).not.toContain('Wer');
    expect(screen.queryByTestId('who-tab')).toBeNull();
  });

  it('an automatic action has Bedingung and Ergebnis and no Wer tab', async () => {
    mount();
    await userEvent.click(
      document.querySelector('[data-path="tasks.eskalieren.auto.eskalation_nach_frist"]') as HTMLElement,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Bedingung', 'Ergebnis']);
    expect(screen.getByTestId('rule-tab-condition')).toBeTruthy();
    expect(screen.getByTestId('rule-trigger-kind')).toBeTruthy();
  });

  it('a task only the system runs has no form section', async () => {
    const doc = meldung().apply({
      kind: 'set',
      path: 'tasks.nur_system',
      // two automatic actions and no `who`: no single action owns the task, and no person may run it
      value: {
        label: { de: 'Nur System' },
        on: 'meldung',
        auto: {
          a: { elapsed: { from: 'self.gemeldet_am' } },
          b: { elapsed: { from: 'self.gemeldet_am', after: 'days(1)' } },
        },
      },
    }).doc;
    mount(doc);
    await userEvent.click(document.querySelector('[data-path="tasks.nur_system"]') as HTMLElement);
    expect(screen.queryByRole('tab', { name: 'Formular' })).toBeNull();
  });
});
