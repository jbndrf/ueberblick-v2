// @vitest-environment jsdom
// WP-362: the Objekt's page as the admin sees it (v3 `instances/[id]/+page.svelte`): header, Standort, tabs Daten and Aktivität,
// refused runs, "Mehr laden".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type { HistoryPage } from '@ueberblick/server';
import FeatureDetail from './FeatureDetail.svelte';
import { row, runs, type as typeDef } from './fixtures.testing';

const older: HistoryPage = {
  runs: [
    {
      ...(runs[1] as (typeof runs)[number]),
      id: 'r-old',
      task: 'erfassen',
      observations: [{ property: 'befund', result: 'Ältester Befund', time: null }],
    },
  ],
  next: null,
  labels: {},
};

const requests: URL[] = [];
beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://x');
      requests.push(url);
      const body = url.pathname.includes('/ogc/')
        ? { geometry: { type: 'Point', coordinates: [7.1, 50.2] } }
        : older;
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const props = {
  locale: 'de' as const,
  project: 'musterstadt',
  typeKey: 'baum',
  type: typeDef,
  tasks: { kontrolle: { label: { de: 'Kontrolle' } } } as never,
  row,
  history: { runs, next: null } as HistoryPage,
  names: { u1: 'Anna Beispiel', u2: 'Bernd Beispiel' },
  basemap: null,
  backHref: '/admin/projects/musterstadt/types/baum',
};

describe('the header', () => {
  it('shows the name, the way back, and Stufe, Status, Erstellt von, Erstellt am, Zuletzt geändert', () => {
    render(FeatureDetail, props);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Eiche am Markt');
    const back = screen.getByTestId('feature-back');
    expect(back.textContent?.trim()).toBe('Zurück zu den Objekten');
    expect(back.getAttribute('href')).toBe('/admin/projects/musterstadt/types/baum');
    const header = screen.getByTestId('feature-header');
    expect(within(header).getByText('Stufe')).toBeTruthy();
    expect(within(header).getByText('Kontrolliert')).toBeTruthy();
    expect(within(header).getByText('aktiv')).toBeTruthy();
    expect(within(header).getByText('Anna Beispiel')).toBeTruthy();
    expect(within(header).getByText('Zuletzt geändert')).toBeTruthy();
  });

  it('shows the lifecycle of a deleted Objekt too', () => {
    render(FeatureDetail, { ...props, row: { ...row, $lifecycle: 'deleted' } });
    expect(within(screen.getByTestId('feature-header')).getByText('gelöscht')).toBeTruthy();
  });
});

describe('Standort', () => {
  it('draws the location after reading the geometry, with the coordinates', async () => {
    render(FeatureDetail, props);
    expect(screen.getByTestId('feature-coordinates').textContent?.trim()).toBe('50.20000, 7.10000');
    await waitFor(() =>
      expect(requests.some((u) => u.pathname.includes('/ogc/collections/baum/items/f1'))).toBe(true),
    );
  });

  it('says so when there is no location, and reads nothing', () => {
    render(FeatureDetail, { ...props, row: { ...row, lon: null, lat: null } });
    expect(screen.getByTestId('feature-no-location').textContent).toBe('Kein Standort festgelegt');
    expect(requests).toEqual([]);
  });
});

describe('Daten', () => {
  it('lists every property with its label and value, grouped by tab, with no Protokolle tab', () => {
    render(FeatureDetail, props);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Daten', 'Aktivität']);
    const data = screen.getByTestId('feature-data');
    expect(within(data).getByText('Allgemein')).toBeTruthy();
    expect(within(data).getByText('Pflege')).toBeTruthy();
    const befund = within(data).getByTestId('data-row-befund');
    expect(within(befund).getByText('Befund')).toBeTruthy();
    expect(within(befund).getByText('Kronenpflege')).toBeTruthy();
    expect(within(within(data).getByTestId('data-row-hoehe_m')).getByText('12,5')).toBeTruthy();
    expect(within(within(data).getByTestId('data-row-zustaendig')).getByText('Bernd Beispiel')).toBeTruthy();
  });

  it('says so when no value is recorded', () => {
    render(FeatureDetail, {
      ...props,
      row: {
        ...row,
        titel: undefined,
        befund: undefined,
        hoehe_m: undefined,
        kontrolle_faellig: undefined,
        zustaendig: undefined,
      },
    });
    expect(screen.getByTestId('feature-data-empty').textContent).toBe(
      'Keine Daten für dieses Objekt erfasst.',
    );
  });
});

describe('Aktivität', () => {
  async function open(over: Partial<typeof props> = {}): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(FeatureDetail, { ...props, ...over });
    await user.click(screen.getByRole('tab', { name: 'Aktivität' }));
    return user;
  }

  it('groups by stage visit, newest first, with task, name and the creating run last', async () => {
    await open();
    const segments = screen.getAllByTestId('activity-segment');
    expect(segments).toHaveLength(2);
    expect(within(segments[0] as HTMLElement).getByText('Kontrolliert')).toBeTruthy();
    expect(within(segments[1] as HTMLElement).getByText('Erfasst')).toBeTruthy();
    const entries = within(segments[0] as HTMLElement).getAllByTestId('activity-entry');
    expect(entries[1]?.textContent).toContain('2 Felder aktualisiert');
    expect(entries[1]?.textContent).toContain('Kontrolle · Bernd Beispiel');
    expect(within(segments[1] as HTMLElement).getAllByTestId('activity-entry')[0]?.textContent).toContain(
      'Erstellt',
    );
  });

  it('opens a run to the values it wrote', async () => {
    await open();
    const entry = screen.getAllByTestId('activity-entry')[1] as HTMLElement;
    const detail = within(entry).getByTestId('activity-detail');
    expect(within(detail).getByText('Befund')).toBeTruthy();
    expect(within(detail).getByText('Kronenpflege')).toBeTruthy();
    expect(within(detail).getByText('Höhe (m)')).toBeTruthy();
  });

  it('marks a refused run and gives the reason', async () => {
    await open();
    expect(screen.getByTestId('activity-refused').textContent?.trim()).toBe('Abgelehnt');
    expect(screen.getByTestId('activity-refusal').textContent).toBe('Befund muss sich ändern');
  });

  it('says so when there is no activity', async () => {
    await open({ history: { runs: [], next: null, labels: {} }, row: { ...row, $created_at: undefined } });
    expect(screen.getByTestId('feature-activity-empty').textContent).toBe('Noch keine Aktivität erfasst.');
  });

  it('"Mehr laden" asks for the next page by cursor and appends it; the button goes at the end', async () => {
    const user = await open({ history: { runs, next: '17', labels: {} } });
    await user.click(screen.getByTestId('activity-more'));
    await waitFor(() => expect(screen.queryByTestId('activity-more')).toBeNull());
    const asked = requests.find((u) => u.pathname.endsWith('/features/f1/history')) as URL;
    expect(asked.pathname).toBe('/api/admin/p/musterstadt/features/f1/history');
    expect(asked.searchParams.get('cursor')).toBe('17');
    expect(screen.getAllByTestId('activity-entry')).toHaveLength(4);
    expect(screen.getByText('Ältester Befund')).toBeTruthy();
  });
});
