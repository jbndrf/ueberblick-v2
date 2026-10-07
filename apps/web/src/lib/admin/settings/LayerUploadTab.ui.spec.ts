// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import LayerUploadTab from './LayerUploadTab.svelte';
import type { LayerDraft } from './layers-model';
import type { UploadJobView } from './tile-upload';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const job = (over: Partial<UploadJobView> = {}): UploadJobView => ({
  id: 'u1',
  state: 'receiving',
  size: 8,
  received: 0,
  progress: { done: 0, total: 0 },
  ...over,
});
const RESULT = {
  url: '/api/p/p/tiles/archives/ab12.pmtiles',
  archive: 'ab12',
  format: 'png' as const,
  bounds: [0, 0, 1, 1],
  minZoom: 1,
  maxZoom: 12,
};

/** A server whose chunk and status answers the test steers. */
function setup(opts: { statuses?: UploadJobView[]; start?: Response; locale?: 'de' | 'en' }) {
  const statuses = [...(opts.statuses ?? [])];
  const bodies: unknown[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && u.endsWith('/uploads')) {
      bodies.push(JSON.parse(String(init?.body)));
      return opts.start ?? json(job(), 201);
    }
    if (method === 'PUT') {
      await gate;
      return json(job({ received: 8 }));
    }
    if (method === 'POST') return json(job({ state: 'queued', received: 8 }), 202);
    return json(statuses.shift() ?? job({ state: 'done', result: RESULT }));
  });
  const onadd = vi.fn<(layer: LayerDraft) => Promise<boolean>>(async () => true);
  const onvector = vi.fn();
  render(LayerUploadTab, {
    locale: opts.locale ?? 'de',
    project: 'p',
    id: 'up',
    onadd,
    onvector,
    fetchFn: fetchFn as unknown as typeof fetch,
    wait: async () => {},
  });
  return { fetchFn, onadd, onvector, release, bodies };
}

/** The kit's file input has `bind:files`, which user-event's own `files` getter fights; the change event carries the file. */
async function pick(_user: ReturnType<typeof userEvent.setup>, fileName: string, label: string) {
  const input = screen.getByLabelText(label);
  const file = new File([new Uint8Array(8)], fileName);
  await fireEvent.change(input, { target: { files: [file] } });
}

describe('Hochladen tab (v3 LayersSection.svelte:712-795)', () => {
  it('names the layer after the file, and the button waits for name and file', async () => {
    const user = userEvent.setup();
    setup({});
    const button = screen.getByRole('button', { name: 'Kacheln hochladen' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await pick(user, 'Luftbild.zip', 'Kacheldatei');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Luftbild');
    expect(button.disabled).toBe(false);
    for (const f of ['PNG', 'JPG', 'WEBP']) expect(screen.getByRole('button', { name: f })).toBeTruthy();
  });

  it('shows the sending progress, then the processing percent, then adds the layer', async () => {
    const user = userEvent.setup();
    const s = setup({
      statuses: [
        job({ state: 'processing', received: 8, progress: { done: 1, total: 4 } }),
        job({ state: 'done', received: 8, result: RESULT }),
      ],
    });
    await pick(user, 'Luftbild.zip', 'Kacheldatei');
    await user.click(screen.getByRole('button', { name: 'WEBP' }));
    await user.click(screen.getByRole('button', { name: 'Kacheln hochladen' }));
    const progress = await screen.findByTestId('upload-progress');
    expect(progress.textContent).toContain('Wird hochgeladen...');
    expect(progress.textContent).toContain('0.0 MB / 0.0 MB (0%)');
    expect(s.bodies[0]).toEqual({ kind: 'zip', name: 'Luftbild', size: 8, format: 'webp' });
    s.release();
    await waitFor(() => expect(s.onadd).toHaveBeenCalledTimes(1));
    expect(s.onadd.mock.calls[0]?.[0]).toEqual({
      label: 'Luftbild',
      kind: 'overlay',
      source: { type: 'pmtiles', url: RESULT.url, tile_type: 'raster' },
      minzoom: 1,
      maxzoom: 12,
    });
    expect(toast.success).toHaveBeenCalledWith('Upload abgeschlossen, Kacheln werden verarbeitet...');
    expect(toast.success).toHaveBeenCalledWith('Kachelverarbeitung abgeschlossen');
  });

  it('shows "Wird verarbeitet... 25%" while the server converts', async () => {
    const user = userEvent.setup();
    let seen = '';
    const s = setup({
      statuses: [job({ state: 'processing', received: 8, progress: { done: 1, total: 4 } })],
    });
    s.fetchFn.mockImplementation(async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && u.endsWith('/uploads')) return json(job(), 201);
      if (method === 'PUT') return json(job({ received: 8 }));
      if (method === 'POST') return json(job({ state: 'queued' }), 202);
      await tick(); // the page draws the state the upload just reached
      seen = screen.queryByTestId('upload-progress')?.textContent ?? '';
      return json(job({ state: 'done', received: 8, result: RESULT }));
    });
    await pick(user, 'a.zip', 'Kacheldatei');
    await user.click(screen.getByRole('button', { name: 'Kacheln hochladen' }));
    await waitFor(() => expect(s.onadd).toHaveBeenCalled());
    expect(seen).toContain('Wird verarbeitet...');
  });

  it('MBTiles and PMTiles say their own format: the format buttons rest and no format is sent', async () => {
    const user = userEvent.setup();
    const s = setup({});
    await pick(user, 'stadt.mbtiles', 'Kacheldatei');
    expect((screen.getByRole('button', { name: 'PNG' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Das Format wird aus der Datei gelesen.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Kacheln hochladen' }));
    await waitFor(() => expect(s.bodies.length).toBe(1));
    expect(s.bodies[0]).toEqual({ kind: 'mbtiles', name: 'stadt', size: 8 });
    s.release();
  });

  it('hands a vector archive to the PMTiles tab instead of adding a raster layer', async () => {
    const user = userEvent.setup();
    const s = setup({
      statuses: [job({ state: 'done', received: 8, result: { ...RESULT, format: 'pbf' as never } })],
    });
    await pick(user, 'v.pmtiles', 'Kacheldatei');
    await user.click(screen.getByRole('button', { name: 'Kacheln hochladen' }));
    s.release();
    await waitFor(() => expect(s.onvector).toHaveBeenCalledWith('v', RESULT.url));
    expect(s.onadd).not.toHaveBeenCalled();
  });
});

const REASONS = {
  too_large: ['Die Datei ist zu groß (höchstens 2 GB).', 'The file is too large (2 GB at most).'],
  too_many_tiles: [
    'Das Archiv hat zu viele Kacheln (höchstens 1.000.000).',
    'The archive has too many tiles (1,000,000 at most).',
  ],
  tile_too_large: ['Eine Kachel ist zu groß (höchstens 4 MiB).', 'A tile is too large (4 MiB at most).'],
  zip_bomb: [
    'Das ZIP entpackt sich zu groß und wurde abgelehnt.',
    'The ZIP expands too far and was refused.',
  ],
  not_tiles: [
    'Die Datei enthält keine Kacheln im erwarteten Aufbau (z/x/y.ext).',
    'The file holds no tiles in the expected layout (z/x/y.ext).',
  ],
  corrupt: [
    'Die Datei ist beschädigt oder keine ZIP-, MBTiles- oder PMTiles-Datei.',
    'The file is damaged or not a ZIP, MBTiles or PMTiles file.',
  ],
  wrong_format: ['Die Kacheln haben nicht das gewählte Format.', 'The tiles are not of the chosen format.'],
  incomplete: [
    'Der Upload endete, bevor alle Daten angekommen waren.',
    'The upload ended before all data arrived.',
  ],
} as const;

describe.each(['de', 'en'] as const)('typed failures in %s', (locale) => {
  const names = { de: ['Kacheldatei', 'Kacheln hochladen'], en: ['Tile file', 'Upload tiles'] } as const;
  const idx = locale === 'de' ? 0 : 1;

  it.each(Object.entries(REASONS))('a failed conversion (%s) says why', async (reason, texts) => {
    const user = userEvent.setup();
    const s = setup({
      locale,
      statuses: [
        job({
          state: 'failed',
          received: 8,
          error: { reason: reason as keyof typeof REASONS, message: 'x' },
        }),
      ],
    });
    await pick(user, 'a.zip', names[locale][0]);
    await user.click(screen.getByRole('button', { name: names[locale][1] }));
    s.release();
    expect((await screen.findByRole('alert')).textContent).toBe(texts[idx]);
    expect(s.onadd).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('a refused start (too_large, 413) says why', async () => {
    const user = userEvent.setup();
    setup({
      locale,
      start: json({ error: { code: 'upload_refused', reason: 'too_large', message: 'x' } }, 413),
    });
    await pick(user, 'a.zip', names[locale][0]);
    await user.click(screen.getByRole('button', { name: names[locale][1] }));
    expect((await screen.findByRole('alert')).textContent).toBe(REASONS.too_large[idx]);
  });
});
