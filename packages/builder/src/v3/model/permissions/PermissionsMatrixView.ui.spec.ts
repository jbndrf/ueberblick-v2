// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import userEvent from '@testing-library/user-event';
import { parse, stringify } from 'yaml';
import { compile, compilePerms, NO_ASSETS, roleSubject, type Key } from '@ueberblick/core';
import { openProject, type Doc } from '../../../doc';
import { musterstadt } from '../../../testing/golden';
import BuilderShell from '../../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../../shell/registry';
import { registerModelView } from './index';

beforeAll(() => {
  class Noop {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver ??= Noop as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
});
afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function mount(doc: Doc = clean(), type = 'baum') {
  const registry = createBuilderRegistry();
  registerModelView(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type, locale: 'de', registry, view: 'model', onchange });
  // v3 opens the Modell view on Felder; the matrix is its second tab.
  screen.getByRole('tab', { name: 'Berechtigungen' }).click();
  flushSync();
  const last = (): Doc => (onchange.mock.calls.at(-1)?.[0] as Doc) ?? doc;
  return { onchange, last, matrix: () => screen.getByTestId('permission-matrix') };
}

const row = (id: string): HTMLElement => document.querySelector(`[data-row="${id}"]`) as HTMLElement;
const box = (id: string, name: RegExp | string): HTMLElement =>
  within(row(id)).getByRole('checkbox', { name });

function canWrite(doc: Doc, type: string, role: string, property: string): boolean {
  const c = compile(doc.effective(), { assets: NO_ASSETS });
  if (!c.ok) throw new Error('does not compile');
  return (
    compilePerms(c.config)
      .forType(type as Key)
      ?.canWrite([roleSubject(role)], [property]).ok ?? false
  );
}

describe('the Modell view holds the Berechtigungen tab (acceptance 1)', () => {
  it('shows the tab strip and the matrix with v3 labels, roles as columns', () => {
    const { matrix } = mount();
    expect(screen.getByRole('tab', { name: 'Berechtigungen' }).getAttribute('aria-selected')).toBe('true');
    const m = within(matrix());
    expect(m.getByText('Objektart-Berechtigungen')).toBeTruthy();
    expect(m.getByText(/gestricheltes Symbol/)).toBeTruthy();
    for (const role of ['Baumkontrolle', 'Bauhof', 'Verwaltung']) {
      expect(m.getByRole('columnheader', { name: role })).toBeTruthy();
    }
    expect(m.getByText('Was jede Rolle sehen kann')).toBeTruthy();
    expect(m.getByText('Feldzugriff (Lesen / Bearbeiten)')).toBeTruthy();
    expect(m.getByText('Kann die Objekte dieser Objektart sehen')).toBeTruthy();
    expect(m.getAllByText('Kann Wert bearbeiten').length).toBeGreaterThan(5);
    for (const legend of ['Erlaubt', 'Bearbeiten erlaubt', 'Alle Rollen', 'Nicht erlaubt']) {
      expect(m.getByText(legend)).toBeTruthy();
    }
  });

  it('a cell shows what core.perms says: Bearbeiten of Höhe (m) is for the Baumkontrolle only', () => {
    mount();
    expect(box('baum.write.hoehe_m', /Baumkontrolle/).getAttribute('aria-checked')).toBe('true');
    expect(box('baum.write.hoehe_m', /Bauhof/).getAttribute('aria-checked')).toBe('false');
    expect(box('baum.write.foto', /Bauhof/).getAttribute('aria-checked')).toBe('true');
  });

  it('Erstellen and Löschen are Erweitert rows, as v3 hid its advanced rows', async () => {
    mount();
    expect(screen.queryByText('Kann Objekte erstellen')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Erweitert' }));
    expect(screen.getByText('Kann Objekte erstellen')).toBeTruthy();
    expect(screen.getByText('Kann Objekte löschen')).toBeTruthy();
    expect(box('baum.create', /Verwaltung/).getAttribute('aria-checked')).toBe('true');
    expect(box('baum.create', /Bauhof/).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Einfach' }));
    expect(screen.queryByText('Kann Objekte erstellen')).toBeNull();
  });
});

describe('toggling a cell writes the draft (acceptance 2)', () => {
  it('turns Bauhof on for Höhe (m) and the Baumkontrolle keeps it', async () => {
    const { last } = mount();
    await userEvent.click(box('baum.write.hoehe_m', /Bauhof/));
    expect(canWrite(last(), 'baum', 'bauhof', 'hoehe_m')).toBe(true);
    expect(canWrite(last(), 'baum', 'kontrolle', 'hoehe_m')).toBe(true);
    expect(box('baum.write.hoehe_m', /Bauhof/).getAttribute('aria-checked')).toBe('true');
  });

  it('a type-level cell: Erstellen for Bauhof', async () => {
    const { last } = mount(clean(), 'massnahme');
    await userEvent.click(screen.getByRole('button', { name: 'Erweitert' }));
    await userEvent.click(box('massnahme.create', /Bauhof/));
    // Kontrolle and Verwaltung could, Bauhof joins: every role, so the audience is $all (v3: empty = all)
    expect(last().effective().types?.['massnahme']?.permissions?.create).toBe('$all');
    expect(box('massnahme.create', /Bauhof/).getAttribute('aria-checked')).toBe('true');
  });

  it('a locked cell cannot be toggled and says why', async () => {
    const { onchange } = mount();
    const locked = box('baum.see', /Bauhof/);
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.getAttribute('title')).toMatch(/Alle Rollen sehen die Objekte/);
    await userEvent.click(locked);
    expect(onchange).not.toHaveBeenCalled();
  });
});

describe('provenance mark and reset per cell (acceptance 3)', () => {
  it('a changed cell shows a reset; it puts the cell back to the template', async () => {
    const { last } = mount();
    expect(screen.queryAllByTestId('matrix-reset')).toHaveLength(0);
    await userEvent.click(box('baum.write.hoehe_m', /Bauhof/));
    const resets = screen.getAllByTestId('matrix-reset');
    expect(resets).toHaveLength(1);
    expect(resets[0]?.getAttribute('aria-label')).toBe('Zurücksetzen: Bauhof, Höhe (m)');
    await userEvent.click(resets[0] as HTMLElement);
    expect(screen.queryAllByTestId('matrix-reset')).toHaveLength(0);
    expect(canWrite(last(), 'baum', 'bauhof', 'hoehe_m')).toBe(false);
  });
});

describe('Private Objekte (acceptance 4)', () => {
  it('the switch writes and clears visible_when', async () => {
    const { last } = mount(clean(), 'massnahme');
    const sw = screen.getByRole('switch', { name: 'Private Objekte' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(sw);
    expect(last().effective().types?.['massnahme']?.permissions?.visible_when).toBe(
      'self.$created_by == actor.id',
    );
    expect(screen.getByRole('switch', { name: 'Private Objekte' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('switch', { name: 'Private Objekte' }));
    expect(last().effective().types?.['massnahme']?.permissions?.visible_when).toBeUndefined();
  });

  it('another condition disables the switch and is shown', () => {
    const doc = clean().apply({
      kind: 'add',
      path: 'types.massnahme.permissions.visible_when',
      value: 'self.erledigt_am == null',
    }).doc;
    mount(doc, 'massnahme');
    expect((screen.getByRole('switch', { name: 'Private Objekte' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('status').textContent).toContain('self.erledigt_am == null');
  });
});

describe('empty and unavailable states (v3: no roles)', () => {
  it('a project without roles says so and links to the Rollen page', () => {
    const template = parse(musterstadt.templateSrc) as Record<string, unknown> & {
      types: Record<string, { permissions?: unknown }>;
    };
    delete template['roles'];
    for (const t of Object.values(template.types)) {
      t.permissions = { see: '$all' };
      // `select.all` names roles, which this template no longer has
      for (const p of Object.values(
        (t as { properties?: Record<string, Record<string, unknown>> }).properties ?? {},
      ))
        delete p['select'];
    }
    delete template['tasks'];
    delete template['views'];
    delete template['rules'];
    const doc = openProject(stringify(template), 'schema: ueberblick/1\nextends: baumkataster@1\n');
    mount(doc, 'baum');
    const text = screen.getByTestId('permission-matrix').textContent ?? '';
    expect(text).toMatch(/noch keine Rollen/);
    // v3: "Rollen verwalten" leads to the roles page of the project (the builder is at .../<p>/types/<type>/builder)
    expect(screen.getByRole('link', { name: 'Rollen verwalten' }).getAttribute('href')).toBe('../../roles');
  });

  it('a draft that does not compile shows a notice instead of wrong cells', () => {
    const doc = clean().apply({
      kind: 'set',
      path: 'types.baum.properties.art.to',
      value: 'gibt_es_nicht',
    }).doc;
    mount(doc, 'baum');
    expect(screen.getByTestId('matrix-unavailable').textContent).toMatch(/keine Fehler mehr/);
  });
});

describe('matrix controls', () => {
  it('has no row or column toggle (v3 has none): every checkbox is one role in one row', () => {
    mount();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.getAttribute('aria-label')).toMatch(/\S/);
    // the only buttons besides cells are the density buttons, the Private switch and resets
    expect(
      screen.queryByRole('button', { name: /alle (Rollen|Zeilen|Spalten)|Zeile|Spalte|all roles/i }),
    ).toBeNull();
  });
});
