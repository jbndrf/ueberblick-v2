// @vitest-environment jsdom
// WP-372 (owner A3): the Protokoll of a past run: the run's form, filled, read-only, with a print button; the Aktivität
// entries open it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type { HistoryPage, Protokoll } from '@ueberblick/server';
import FeatureDetail from './FeatureDetail.svelte';
import ProtokollView from './ProtokollView.svelte';
import { PROTOKOLL_PRINT_CSS } from './protokoll-print';
import { row, runs, type as typeDef } from './fixtures.testing';

const protokoll: Protokoll = {
  run: {
    id: 'r2',
    task: 'kontrolle',
    taskLabel: { de: 'Kontrolle durchführen' },
    actor: { id: 'u2', kind: 'participant', name: null },
    receivedAt: '2026-03-03T10:00:00.000Z',
    clientTime: null,
    configVersion: 1,
  },
  type: 'baum',
  form: {
    befund: { required: true },
    hoehe_m: {},
    kontrolle_faellig: {},
    zustaendig: {},
    geometrie: { tool: 'draw' },
  },
  properties: {
    befund: { type: 'text', label: { de: 'Befund' } },
    hoehe_m: { type: 'number', label: { de: 'Höhe (m)' } },
    kontrolle_faellig: { type: 'boolean', label: { de: 'Kontrolle fällig' } },
    zustaendig: { type: 'participant', label: { de: 'Zuständig' } },
    geometrie: { type: 'geometry', label: { de: 'Lage' } },
  } as never,
  values: {
    befund: 'Kronenpflege',
    hoehe_m: 12.5,
    kontrolle_faellig: true,
    zustaendig: 'u1',
    geometrie: { type: 'Point', coordinates: [7.1, 50.2] },
  },
  labels: {},
};
const props = {
  locale: 'de' as const,
  project: 'musterstadt',
  protokoll,
  names: { u1: 'Anna Beispiel', u2: 'Bernd Beispiel' },
  backHref: '/admin/projects/musterstadt/types/baum/f1',
};

afterEach(() => vi.unstubAllGlobals());

describe('the Protokoll names a referenced feature (WP-1076)', () => {
  const resolved = 'a7d3d241-8c7e-71ca-8727-44ab2c8a8720';
  const gone = '5089e484-874a-74ab-9db1-dfa80a72cf87';
  const render2 = (values: Protokoll['values'], labels: Protokoll['labels']) =>
    render(ProtokollView, {
      ...props,
      protokoll: {
        ...protokoll,
        form: { baum: {}, aus: {} } as never,
        properties: {
          baum: { type: 'reference', to: 'baum', label: { de: 'Baum' } },
          aus: { type: 'reference', to: 'kontrolle', label: { de: 'Aus Kontrolle' } },
        } as never,
        values,
        labels,
      },
    });

  it('shows the name of a resolved reference and the short id of an unresolved one, never a 36-character id', async () => {
    render2({ baum: resolved, aus: gone }, { [resolved]: 'Baum #4139' });
    const form = await screen.findByTestId('protokoll-form');
    const shown = (label: string) => (within(form).getByLabelText(label) as HTMLInputElement).value;
    expect(shown('Baum')).toBe('Baum #4139');
    expect(shown('Aus Kontrolle')).toBe('#cf87');
    expect(form.innerHTML).not.toContain(resolved);
    expect(form.innerHTML).not.toContain(gone);
  });
});

describe('the Protokoll photos (WP-743)', () => {
  it('a thumbnail that does not load shows the original file, then the placeholder', async () => {
    const sha = 'c'.repeat(64);
    render(ProtokollView, {
      ...props,
      protokoll: {
        ...protokoll,
        form: { fotos: { tool: 'photo' } } as never,
        properties: { fotos: { type: 'file', label: { de: 'Fotos' } } } as never,
        values: { fotos: [{ sha256: sha, name: 'baum.jpg', mime: 'image/jpeg' }] },
      },
    });
    const img = async () => (await screen.findByTestId('protokoll-form')).querySelector('img');
    await vi.waitFor(async () =>
      expect((await img())?.getAttribute('src')).toBe(`/api/p/musterstadt/blobs/${sha}?thumb=preview`),
    );
    fireEvent.error((await img()) as Element);
    await vi.waitFor(async () =>
      expect((await img())?.getAttribute('src')).toBe(`/api/p/musterstadt/blobs/${sha}`),
    );
    fireEvent.error((await img()) as Element);
    await vi.waitFor(async () => expect(await img()).toBeNull());
  });
});

describe('the Protokoll view', () => {
  it('is titled "Protokoll vom <Datum>, <Autor>" with the task and a way back to Aktivität', () => {
    render(ProtokollView, props);
    const title = screen.getByTestId('protokoll-title').textContent ?? '';
    expect(title).toMatch(/^Protokoll vom .*2026.*, Bernd Beispiel$/);
    expect(screen.getByTestId('protokoll-task').textContent).toBe('Kontrolle durchführen');
    expect(screen.getByTestId('protokoll-back').getAttribute('href')).toBe(props.backHref);
    expect(screen.getByTestId('protokoll-back').textContent?.trim()).toBe('Zurück zur Aktivität');
  });

  it('shows every visible field filled and read-only, with no submit', () => {
    render(ProtokollView, props);
    const form = screen.getByTestId('protokoll-form');
    const befund = within(form).getByLabelText(/Befund/) as HTMLInputElement;
    expect(befund.value).toBe('Kronenpflege');
    expect(befund.readOnly).toBe(true);
    expect(befund.disabled).toBe(false);
    expect((within(form).getByLabelText(/Höhe/) as HTMLInputElement).value).toBe('12.5');
    expect(within(form).getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    expect((within(form).getByLabelText('Zuständig') as HTMLInputElement).value).toBe('Anna Beispiel');
    expect(within(form).getByTestId('protokoll-geometry').textContent).toBe('Standort: 50.20000, 7.10000');
    expect(within(form).queryByRole('button', { name: /Absenden/ })).toBeNull();
  });

  it('shows only the fields the server sent: a field absent from the response is absent from the view', () => {
    const { befund, ...rest } = protokoll.properties as Record<string, unknown>;
    const { befund: _b, ...form } = protokoll.form as Record<string, unknown>;
    void befund;
    void _b;
    render(ProtokollView, {
      ...props,
      protokoll: { ...protokoll, form: form as never, properties: rest as never },
    });
    expect(screen.queryByLabelText(/Befund/)).toBeNull();
    expect(screen.getByLabelText(/Höhe/)).toBeTruthy();
  });

  it('prints with the browser (Als PDF exportieren) and ships a print stylesheet that drops the shell', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(ProtokollView, props);
    await userEvent.setup().click(screen.getByTestId('protokoll-print'));
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getByTestId('protokoll-print').textContent?.trim()).toBe('Als PDF exportieren');
    expect(document.head.innerHTML).toContain('@media print');
    expect(PROTOKOLL_PRINT_CSS).toContain("[data-slot='sidebar']");
    expect(PROTOKOLL_PRINT_CSS).toContain("[data-slot='sidebar-inset'] > header");
    expect(PROTOKOLL_PRINT_CSS).toContain('overflow: visible');
    expect(PROTOKOLL_PRINT_CSS).toContain('.protokoll-noprint');
  });

  it('says so in English', () => {
    render(ProtokollView, { ...props, locale: 'en' });
    expect(screen.getByTestId('protokoll-title').textContent).toMatch(/^Protocol of .*, Bernd Beispiel$/);
    expect(screen.getByTestId('protokoll-print').textContent?.trim()).toBe('Export as PDF');
  });
});

describe('the Protokoll author', () => {
  const by = (id: string, kind: 'admin' | 'import') =>
    render(ProtokollView, {
      ...props,
      names: { a1: 'chef@example.org' },
      protokoll: { ...protokoll, run: { ...protokoll.run, actor: { id, kind, name: null } } },
    });
  it('names an admin by e-mail', () => {
    by('a1', 'admin');
    expect(document.body.textContent).toContain('chef@example.org');
  });
  it('names an import with the admin who ran it', () => {
    by('import:a1', 'import');
    expect(document.body.textContent).toContain('Import (chef@example.org)');
  });
});

describe('Aktivität opens a Protokoll', () => {
  it('links every accepted run, not a refused one', async () => {
    render(FeatureDetail, {
      locale: 'de' as const,
      project: 'musterstadt',
      typeKey: 'baum',
      type: typeDef,
      tasks: { kontrolle: { label: { de: 'Kontrolle' } } } as never,
      row,
      history: { runs, next: null } as HistoryPage,
      names: {},
      basemap: null,
      backHref: '/x',
    });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Aktivität' }));
    const links = screen.getAllByTestId('activity-protokoll');
    expect(links).toHaveLength(runs.filter((r) => r.outcome === 'accepted').length);
    expect(links[0]?.textContent?.trim()).toBe('Protokoll öffnen');
    const base = '/admin/projects/musterstadt/types/baum/f1/protokoll/';
    const hrefs = links.map((l) => l.getAttribute('href'));
    // the update (an entry) and the stage change (the heading's line, since it is no entry of its own)
    expect(hrefs).toContain(base + 'r2');
    expect(hrefs).toContain(base + 'r1');
    expect(hrefs).not.toContain(base + 'r3');
  });
});
