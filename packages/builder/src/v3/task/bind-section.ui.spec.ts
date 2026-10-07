// @vitest-environment jsdom
// WP-458: the Definition tab's "Verknüpfte Objekte" through the frame.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import './shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from './index';

// A test that ends with the impact dialog open leaves the dialog's body
// `pointer-events: none` lock behind for a tick after unmount; the next
// test's first click would then be refused (flake seen on main 50798d966).
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
});

function open(task: string, doc: Doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc)) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  const select = async () =>
    userEvent.click(document.querySelector(`[data-path="tasks.${task}"]`) as HTMLElement);
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  return { select, last };
}
const bindOf = (d: Doc, t: string) => d.effective().tasks?.[t]?.bind;

describe('Verknüpfte Objekte', () => {
  it('lists the declared binds with the relation and its target type', async () => {
    const h = open('kontrolle');
    await h.select();
    const row = screen.getByTestId('task-bind-row');
    expect(row.dataset['bind']).toBe('area');
    expect((screen.getByTestId('task-bind-name') as HTMLInputElement).value).toBe('area');
    expect(screen.getByTestId('task-bind-relation').textContent).toContain('→');
  });

  it('adds a bind from the one-relations only, and removes it again', async () => {
    const h = open('verschieben');
    await h.select();
    expect(screen.queryByTestId('task-bind-row')).toBeNull();
    const add = screen.getByTestId('task-bind-add');
    const values = [...add.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('flaeche');
    expect(values).not.toContain('randlage');
    expect(values).not.toContain('massnahmen');
    await userEvent.selectOptions(add, 'flaeche');
    expect(bindOf(h.last(), 'verschieben')).toEqual({ flaeche: 'self.flaeche' });
    await userEvent.click(screen.getByTestId('task-bind-remove'));
    expect(bindOf(h.last(), 'verschieben')).toBeUndefined();
  });

  it('renames a bind', async () => {
    const h = open('verschieben');
    await h.select();
    await userEvent.selectOptions(screen.getByTestId('task-bind-add'), 'flaeche');
    const name = screen.getByTestId('task-bind-name') as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'Gebiet');
    await userEvent.tab();
    expect(bindOf(h.last(), 'verschieben')).toEqual({ gebiet: 'self.flaeche' });
  });

  it('removing a bind the form uses is refused and names the fields', async () => {
    const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
    const withField = doc.apply({
      kind: 'set',
      path: 'tasks.kontrolle.form["area.name"]',
      value: {},
    }).doc;
    const h = open('kontrolle', withField);
    await h.select();
    await userEvent.click(screen.getByTestId('task-bind-remove'));
    expect(screen.getByTestId('bind-impact-fields').textContent).toContain('area.name');
    expect(screen.getByTestId('bind-impact-expressions').textContent).toContain('area');
    expect(bindOf(h.last() ?? withField, 'kontrolle')).toEqual({ area: 'self.flaeche' });
  });

  it('a refused rename puts the old name back into the input', async () => {
    const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
    const withField = doc.apply({
      kind: 'set',
      path: 'tasks.kontrolle.form["area.name"]',
      value: {},
    }).doc;
    const h = open('kontrolle', withField);
    await h.select();
    const name = screen.getByTestId('task-bind-name') as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'gebiet');
    await userEvent.tab();
    expect(screen.getByTestId('bind-impact-fields').textContent).toContain('area.name');
    expect(screen.getByTestId('bind-impact-expressions').textContent).toContain('area');
    expect(name.value).toBe('area');
    expect(bindOf(h.last() ?? withField, 'kontrolle')).toEqual({ area: 'self.flaeche' });
  });
});
