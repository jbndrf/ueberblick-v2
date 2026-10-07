// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import GeojsonImportDialog from './GeojsonImportDialog.svelte';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
});

const GOLDEN = resolve(process.cwd(), 'fixtures/golden') + '/';
const templateSrc = readFileSync(`${GOLDEN}templates/baumkataster/1.0.0.yaml`, 'utf8');
const overlay = readFileSync(`${GOLDEN}projects/musterstadt-baeume.yaml`, 'utf8');

const FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.1, 50.1] },
      properties: { art: 'Eiche', hoehe: 12, geschuetzt: true },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.2, 50.2] },
      properties: { art: 'Linde', hoehe: 8.5, geschuetzt: false },
    },
  ],
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  init?: RequestInit | undefined;
}
function server(opts: { deploy?: unknown; put?: number } = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/builder-api/muster/draft' && init?.method === 'PUT') return json(opts.put ?? 200, {});
    if (url === '/builder-api/muster/draft') return json(200, { overlay, revision: 7 });
    if (url === '/admin/shell/template/muster') return json(200, { templateSrc });
    if (url.endsWith('/draft/status'))
      return json(200, { dirty: true, neverPublished: false, problems: 0, revision: 8, type: null });
    if (url.endsWith('/deploy')) return json(200, opts.deploy ?? { ok: true, version: 2 });
    if (url.endsWith('/import')) return json(202, { job: 'j1' });
    if (url.endsWith('/import/j1'))
      return json(200, {
        job: { state: 'done', rows_done: 2, rows_total: 2, imported: 2, outcome: 'accepted', problems: [] },
      });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function open(s = server()) {
  const onpublished = vi.fn();
  const ondone = vi.fn();
  render(GeojsonImportDialog, {
    open: true,
    locale: 'de',
    project: 'muster',
    onpublished,
    ondone,
    fetchFn: s.fetchFn,
  });
  return { ...s, onpublished, ondone };
}

/** jsdom's File has no `text()` and its input takes no `files` from user-event: give both by hand. */
async function upload(text: string, name = 'hochstaemme.geojson'): Promise<void> {
  const input = (await screen.findByTestId('geojson-file')) as HTMLInputElement;
  const file = new File([text], name, { type: 'application/geo+json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  await fireEvent.change(input, { target: { files: [file] } });
}

const bodyOf = (c: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(c?.init?.body ?? '{}')) as Record<string, unknown>;

describe('step 1: Hochladen (v3 geojson-import-dialog)', () => {
  it('shows the title, the description and the file input', () => {
    open();
    expect(screen.getByText('GeoJSON importieren')).toBeTruthy();
    expect(screen.getByText(/aus ihren Features eine neue Objektart zu erstellen/)).toBeTruthy();
    expect(screen.getByLabelText('GeoJSON-Datei')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeTruthy();
  });

  it("a file that is not JSON, or not a FeatureCollection, shows v3's errors and stays on the upload step", async () => {
    open();
    await upload('{nope');
    expect(await screen.findByText('Die Datei konnte nicht als JSON gelesen werden.')).toBeTruthy();
    await upload(JSON.stringify({ type: 'Feature', geometry: null, properties: {} }));
    expect(await screen.findByText(/Die Datei ist keine GeoJSON-FeatureCollection/)).toBeTruthy();
    await upload(JSON.stringify({ type: 'FeatureCollection', features: [] }));
    expect(await screen.findByText('Die Datei enthält keine Features.')).toBeTruthy();
    expect(screen.queryByTestId('geojson-name')).toBeNull();
  });
});

describe('step 2: Prüfen', () => {
  it('name from the file name, feature count, geometry kind and one row per property with its inferred type', async () => {
    open();
    await upload(FC);
    expect((await screen.findByTestId('geojson-name')) as HTMLInputElement).toHaveProperty(
      'value',
      'hochstaemme',
    );
    expect(screen.getByTestId('geojson-summary').textContent).toContain('2 Features');
    expect(screen.getByTestId('geojson-summary').textContent).toContain('Geometrietyp: Point');
    expect((screen.getByTestId('geojson-type-0') as HTMLSelectElement).value).toBe('text');
    expect((screen.getByTestId('geojson-type-1') as HTMLSelectElement).value).toBe('number');
    expect((screen.getByTestId('geojson-type-2') as HTMLSelectElement).value).toBe('boolean');
    expect(screen.getByTestId('geojson-unpublished')).toBeTruthy();
  });

  it('no properties: v3 hint; mixed geometries are listed', async () => {
    open();
    await upload(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [1, 2],
                [3, 4],
              ],
            },
            properties: null,
          },
        ],
      }),
    );
    expect(await screen.findByText(/Keine Eigenschaften gefunden/)).toBeTruthy();
    expect(screen.getByTestId('geojson-summary').textContent).toContain('gemischt (Point, LineString)');
  });

  it('the import button is off without a name; Zurück returns to the upload', async () => {
    open();
    await upload(FC);
    const name = (await screen.findByTestId('geojson-name')) as HTMLInputElement;
    await fireEvent.input(name, { target: { value: '  ' } });
    expect((screen.getByTestId('geojson-import') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByTestId('geojson-file')).toBeTruthy();
  });
});

describe('Veröffentlichen und importieren', () => {
  it('writes the type into the draft, publishes, imports as a job and ends at the objects', async () => {
    const w = open();
    await upload(FC);
    const name = (await screen.findByTestId('geojson-name')) as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Hochstämme' } });
    // an override: the boolean column is written as text
    await fireEvent.change(screen.getByTestId('geojson-type-2'), { target: { value: 'text' } });
    await fireEvent.click(screen.getByTestId('geojson-import'));

    expect(await screen.findByTestId('import-result')).toHaveProperty(
      'textContent',
      expect.stringContaining('GeoJSON importiert (2 Features)'),
    );
    const urls = w.calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`);
    const put = urls.indexOf('PUT /builder-api/muster/draft');
    const deploy = urls.indexOf('POST /builder-api/muster/deploy');
    const run = urls.indexOf('POST /api/admin/p/muster/import');
    expect(put).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(put);
    expect(run).toBeGreaterThan(deploy);
    const saved = String(bodyOf(w.calls[put])['overlay']);
    expect(saved).toContain('hochstaemme');
    expect(saved).toContain('hochstaemme_import');
    expect(w.onpublished).toHaveBeenCalledOnce();

    // the job: the mapping names the task and the geometry field
    const form = w.calls[run]?.init?.body as FormData;
    expect(JSON.parse(String(form.get('mapping')))).toMatchObject({
      task: 'hochstaemme_import',
      geometry: { field: 'geometrie' },
      fields: { art: 'art', hoehe: 'hoehe', geschuetzt: 'geschuetzt' },
    });
    expect(form.get('mode')).toBe('skip');
    // the override is read as text: the uploaded file carries the boolean as a string
    const sent = await new Promise<string>((done) => {
      const reader = new FileReader();
      reader.onload = () => done(String(reader.result));
      reader.readAsText(form.get('file') as File);
    });
    expect(sent).toContain('"geschuetzt":"true"');

    await fireEvent.click(screen.getByTestId('import-table'));
    expect(w.ondone).toHaveBeenCalledWith('hochstaemme');
  });

  it('a publish problem keeps the type in the draft: Try again publishes without adding it twice', async () => {
    let first = true;
    const base = server();
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/deploy') && first) {
        first = false;
        return json(422, { ok: false, reason: 'problems', problems: [{ path: 'types.hochstaemme.x' }] });
      }
      return base.fetchFn(url, init);
    }) as typeof fetch;
    const w = open({ calls: base.calls, fetchFn });
    await upload(FC);
    await screen.findByTestId('geojson-name');
    await fireEvent.click(screen.getByTestId('geojson-import'));
    expect(await screen.findByText('1 Problem verhindert das Veröffentlichen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Im Builder öffnen' })).toBeTruthy();
    // the type is in the draft and the form is locked
    expect((screen.getByTestId('geojson-name') as HTMLInputElement).disabled).toBe(true);
    await fireEvent.click(screen.getByTestId('geojson-import'));
    await screen.findByTestId('import-result');
    const puts = w.calls.filter((c) => c.init?.method === 'PUT');
    expect(puts).toHaveLength(1);
  });

  it('a draft that cannot be saved says so and publishes nothing', async () => {
    const w = open(server({ put: 500 }));
    await upload(FC);
    await screen.findByTestId('geojson-name');
    await fireEvent.click(screen.getByTestId('geojson-import'));
    expect(await screen.findByText('Die Objektart konnte nicht im Entwurf angelegt werden.')).toBeTruthy();
    await waitFor(() => expect(w.calls.some((c) => c.url.endsWith('/deploy'))).toBe(false));
  });
});
