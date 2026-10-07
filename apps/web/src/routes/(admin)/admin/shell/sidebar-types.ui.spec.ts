// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '@ueberblick/ui/testing';
import { draftStatus } from '../../../../lib/admin/draft/status-store.svelte';
import ShellSample from './AdminShell.testing.svelte';
import type { SidebarType } from './sidebar-types';

const golden = (rel: string): string => readFileSync(join(process.cwd(), 'fixtures/golden', rel), 'utf8'); // jsdom has no file URL for the spec
const TEMPLATE = golden('templates/baumkataster/1.0.0.yaml');
const OVERLAY = golden('projects/musterstadt-baeume.yaml');

afterEach(() => {
  cleanup();
  draftStatus.clear();
  document.body.style.pointerEvents = '';
});

const PROJECT = { key: 'alpha', name: 'Alpha Stadt' };
const BAUMART: SidebarType = { key: 'baumart', label: 'Baumart', kind: 'table', geometry: false };
const TYPES: SidebarType[] = [
  { key: 'baum', label: 'Baum', kind: 'objektart', geometry: true },
  { key: 'flaeche', label: 'Fläche', kind: 'objektart', geometry: true },
  BAUMART,
];
const base = {
  locale: 'de' as const,
  pathname: '/admin/projects/alpha/types/baum/builder',
  account: { email: 'admin@example.org' },
  projects: [PROJECT],
  currentProject: PROJECT,
  types: TYPES,
  theme: 'light' as const,
  onTheme: () => undefined,
  onLocale: () => undefined,
  onSignOut: () => undefined,
};

/** A draft server stand-in (GET overlay + revision, PUT compare-and-swap) that also answers the status route. */
function draftServer() {
  const state = { overlay: OVERLAY, revision: 1 };
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown, status = 200): Response =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/draft/status'))
      return json({ dirty: true, neverPublished: false, problems: 0, revision: state.revision, type: null });
    if (init?.method === 'PUT') {
      const b = JSON.parse(String(init.body)) as { overlay: string; revision: number };
      if (b.revision !== state.revision) return json({}, 409);
      state.overlay = b.overlay;
      state.revision += 1;
      return json({ revision: state.revision });
    }
    if (url.startsWith('/admin/shell/template/')) return json({ templateSrc: TEMPLATE });
    return json({ template: 'baumkataster', overlay: state.overlay, revision: state.revision }); // the draft names its template
  });
  return { state, f: f as unknown as typeof fetch };
}

describe('the sidebar groups Objektarten and Tabellen (v3 `+layout.svelte:395-545`)', () => {
  it('lists the Objektarten with their icon, links to the data page (S3-18), and marks the current one', () => {
    render(ShellSample, base);
    const group = within(screen.getByTestId('group-types'));
    const baum = group.getByRole('link', { name: 'Baum' });
    expect(baum.getAttribute('href')).toBe('/admin/projects/alpha/types/baum');
    expect(baum.getAttribute('data-active')).toBe('true');
    expect(baum.querySelector('svg')).toBeTruthy();
    expect(group.getByRole('link', { name: 'Fläche' }).getAttribute('data-active')).toBe('false');
    // a Tabelle opens its table page (A-030, S3-24), and the group header opens the overview
    const tables = within(screen.getByTestId('group-tables'));
    expect(tables.getByRole('link', { name: 'Baumart' }).getAttribute('href')).toBe(
      '/admin/projects/alpha/tables/baumart',
    );
    expect(tables.getByRole('link', { name: 'Tabellen' }).getAttribute('href')).toBe(
      '/admin/projects/alpha/tables',
    );
  });

  it('a group of Tabellen still folds (the chevron keeps the label for assistive technology)', async () => {
    render(ShellSample, base);
    await userEvent.click(
      within(screen.getByTestId('group-tables')).getByRole('button', { name: 'Tabellen' }),
    );
    expect(screen.queryByRole('link', { name: 'Baumart' })).toBeNull();
  });

  it('an empty group says so (v3 empty text)', () => {
    render(ShellSample, { ...base, types: [BAUMART] });
    expect(screen.getByText('Noch keine Objektarten')).toBeTruthy();
    expect(screen.queryByText('Noch keine Tabellen')).toBeNull();
  });

  it('a group folds', async () => {
    render(ShellSample, base);
    await userEvent.click(screen.getByRole('button', { name: 'Objektarten' }));
    expect(screen.queryByRole('link', { name: 'Fläche' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Baumart' })).toBeTruthy();
  });
});

describe('"+" creates a type in the draft', () => {
  it('Objektart: menu, name, the draft gets the type, the builder opens, the bar is asked again', async () => {
    const s = draftServer();
    const changesBefore = draftStatus.changes; // a singleton: the count adds up across runs
    const navigate = vi.fn();
    const refresh = vi.fn(async () => undefined);
    render(ShellSample, { ...base, draftFetch: s.f, navigate, refresh });
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByRole('button', { name: 'Objektart hinzufügen' }));
    await user.click(await screen.findByText('Neue Objektart'));
    const create = await screen.findByTestId('new-type-create');
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByTestId('new-type-name'), 'Spielplatz');
    await user.click(create);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/admin/projects/alpha/types/spielplatz/builder'),
    );
    expect(parse(s.state.overlay).add['types.spielplatz'].label).toBe('Spielplatz');
    expect(refresh).toHaveBeenCalled();
    expect(draftStatus.changes).toBe(changesBefore + 1);
  });

  it('Tabelle: its own "+" creates a type without geometry', async () => {
    const s = draftServer();
    render(ShellSample, { ...base, draftFetch: s.f });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Tabelle hinzufügen' }));
    await user.click(await screen.findByText('Neue Tabelle'));
    await user.type(await screen.findByTestId('new-type-name'), 'Strassen');
    await user.click(screen.getByTestId('new-type-create'));
    await waitFor(() => expect(parse(s.state.overlay).add['types.strassen']).toBeTruthy());
    expect(parse(s.state.overlay).add['types.strassen'].geometry).toBeUndefined();
  });

  it('a failing draft keeps the dialog open and says so', async () => {
    const f = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    const navigate = vi.fn();
    render(ShellSample, { ...base, draftFetch: f, navigate });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Objektart hinzufügen' }));
    await user.click(await screen.findByText('Neue Objektart'));
    await user.type(await screen.findByTestId('new-type-name'), 'X');
    await user.click(screen.getByTestId('new-type-create'));
    await waitFor(() =>
      expect(document.body.textContent).toContain('Objektart konnte nicht erstellt werden'),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('drag reorder writes the overlay order', () => {
  it('dropping Baum after Fläche shows the new order and saves `order.types`', async () => {
    const s = draftServer();
    // The page's data is read again after the save; until then the list shows the dropped order (v3's override).
    let done: () => void = () => undefined;
    const refresh = (): Promise<void> => new Promise((resolve) => (done = resolve));
    render(ShellSample, { ...base, draftFetch: s.f, refresh });
    const baum = screen.getByTestId('type-entry-baum');
    const flaeche = screen.getByTestId('type-entry-flaeche');
    await fireEvent.dragStart(baum);
    await fireEvent.dragOver(flaeche, { clientY: 100 }); // below the middle of a zero-height box: after
    expect(flaeche.className).toContain('after:bg-primary');
    expect(baum.className).toContain('opacity-50');
    await fireEvent.drop(flaeche);
    await waitFor(() => expect(parse(s.state.overlay).order.types).toEqual(['flaeche', 'baum', 'baumart']));
    const names = within(screen.getByTestId('group-types'))
      .getAllByRole('link')
      .map((a) => a.textContent?.trim());
    expect(names).toEqual(['Fläche', 'Baum']);
    done();
  });

  it('Tabellen are not draggable (as in v3)', () => {
    render(ShellSample, base);
    expect(screen.getByTestId('type-entry-baumart').getAttribute('draggable')).toBe('false');
    expect(screen.getByTestId('type-entry-baum').getAttribute('draggable')).toBe('true');
  });
});

describe("v3's 'GeoJSON importieren' item (`+layout.svelte:428-431`, WP-390)", () => {
  it('sits in the Objektarten "+" menu and opens the wizard; the Tabellen menu has none', async () => {
    render(ShellSample, base);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Tabelle hinzufügen' }));
    expect(await screen.findByText('Neue Tabelle')).toBeTruthy();
    expect(screen.queryByText('GeoJSON importieren')).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Objektart hinzufügen' }));
    await user.click(await screen.findByText('GeoJSON importieren'));
    expect(await screen.findByTestId('geojson-file')).toBeTruthy();
  });
});
