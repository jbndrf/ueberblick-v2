// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
import CsvImportDialog from './CsvImportDialog.svelte';
import type { ImportSetup } from './setup';

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
});

const setup: ImportSetup = {
  task: 'erfassen',
  taskLabel: 'Baum erfassen',
  fields: [
    { key: 'art', label: 'Art', required: true, kind: 'text' },
    { key: 'hoehe_m', label: 'Höhe (m)', required: false, kind: 'number' },
  ],
  geometry: { field: 'geometrie', point: true, required: true },
  stage: {
    property: 'stage',
    label: 'Status',
    start: 'erfasst',
    options: [
      { value: 'erfasst', label: 'Erfasst' },
      { value: 'kontrolliert', label: 'Kontrolliert' },
    ],
  },
  constants: [{ key: 'befund', label: 'Befund', kind: 'text', options: [] }],
};

const CSV = 'Art;Höhe (m);lat;lon\nEiche;12;50.1;7.1\nBuche;9;50.2;7.2\nLinde;x;50.3;7.3\n';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const need = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('expected a value');
  return v;
};

interface Call {
  url: string;
  init?: RequestInit | undefined;
}
interface Over {
  deploy?: Response;
  status?: Record<string, unknown>;
}
function server(published: boolean, clean = false, over: Over = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/import/plan'))
      return json(200, {
        counts: clean
          ? { valid: 2, problem_rows: 0, problems: 0 }
          : { valid: 2, problem_rows: 1, problems: 1 },
        problems: clean
          ? []
          : [{ row: 3, code: 'row_malformed', message: '"Höhe (m)": not a number', path: 'hoehe_m' }],
        preview: [
          {
            row: 1,
            values: {
              art: 'Eiche',
              hoehe_m: 12,
              stage: 'erfasst',
              geometrie: { type: 'Point', coordinates: [7.1, 50.1] },
            },
          },
          { row: 2, values: { art: 'Buche', hoehe_m: 9, stage: 'erfasst' } },
        ],
      });
    if (url.endsWith('/import')) return json(202, { job: 'j1' });
    if (url.endsWith('/import/j1'))
      return json(200, {
        job: {
          state: 'done',
          rows_done: 3,
          rows_total: 3,
          imported: 2,
          outcome: 'accepted',
          problems: [{ row: 3, code: 'row_malformed', message: 'm' }],
          problem_count: 1,
        },
      });
    if (url.endsWith('/draft/status'))
      return json(200, {
        dirty: true,
        neverPublished: !published,
        problems: 0,
        revision: 2,
        type: 'baum',
        ...over.status,
      });
    if (url.endsWith('/deploy')) return over.deploy ?? json(200, { ok: true, version: 1 });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function open(published: boolean, over: { setup?: ImportSetup | null; clean?: boolean } & Over = {}) {
  const s = server(published, over.clean === true, over);
  const onpublished = vi.fn();
  const ondone = vi.fn();
  render(CsvImportDialog, {
    open: true,
    locale: 'de',
    project: 'muster',
    type: 'baum',
    setup: over.setup === undefined ? setup : over.setup,
    published,
    onpublished,
    ondone,
    fetchFn: s.fetchFn,
  });
  return { ...s, onpublished, ondone };
}

/** jsdom's File has no `text()` and its input takes no `files` from user-event: give both by hand. */
async function upload(text = CSV): Promise<void> {
  const input = (await screen.findByTestId('csv-file')) as HTMLInputElement;
  const file = new File([text], 'baeume.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  await fireEvent.change(input, { target: { files: [file] } });
}

// The import result appears after the publish, the job start and at least one 300 ms poll; under a loaded test run
// that can exceed the default 1 s wait, so these waits allow 5 s (flake seen in two land trains, 2026-10-02).
describe('step 1 and 2: Hochladen and Zuordnen (v3 csv-import-dialog)', () => {
  it('reads the file, auto-maps columns by label and coordinate names, and counts rows and columns', async () => {
    open(true);
    expect(screen.getByText('CSV-Daten importieren')).toBeTruthy();
    await upload();
    expect(await screen.findByTestId('import-found')).toHaveProperty(
      'textContent',
      expect.stringContaining('3 Zeilen gefunden – 4 Spalten gefunden'),
    );
    expect((screen.getByTestId('map-0') as HTMLSelectElement).value).toBe('art');
    expect((screen.getByTestId('map-1') as HTMLSelectElement).value).toBe('hoehe_m');
    expect((screen.getByTestId('map-2') as HTMLSelectElement).value).toBe('$lat');
    expect((screen.getByTestId('map-3') as HTMLSelectElement).value).toBe('$lon');
    // the stage select starts at the process start
    expect((document.getElementById('import-stage') as HTMLSelectElement).value).toBe('erfasst');
  });

  it('Weiter stays off until the starred targets are mapped (v3: Pflichtfelder)', async () => {
    open(true);
    await upload('Name;x\nEiche;1\n');
    expect(await screen.findByText('Alle Pflichtfelder (*) müssen zugeordnet sein.')).toBeTruthy();
    expect((screen.getByTestId('import-next') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByTestId('map-0'), 'art');
    await userEvent.selectOptions(screen.getByTestId('map-1'), '$lat');
    expect((screen.getByTestId('import-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a file without a header row is refused in place', async () => {
    open(true);
    await upload('\n\n');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('map-0')).toBeNull();
  });

  it('a type without a creating task says so (the engine needs one)', async () => {
    open(true, { setup: null });
    expect(await screen.findByTestId('import-no-task')).toBeTruthy();
  });
});

describe('step 3 and 4: Vorschau from the dry run, then the job', () => {
  async function toPreview(c: ReturnType<typeof open>): Promise<void> {
    await upload();
    await userEvent.click(await screen.findByTestId('import-next'));
    await screen.findByTestId('import-ready');
    expect(c.calls.some((x) => x.url.endsWith('/import/plan'))).toBe(true);
  }

  it('sends the mapping to the dry run and shows its rows and its problem (with the row number)', async () => {
    const c = open(true);
    await toPreview(c);
    const plan = need(c.calls.find((x) => x.url.endsWith('/import/plan')));
    const mapping = JSON.parse(String((need(plan.init).body as FormData).get('mapping')));
    expect(mapping).toMatchObject({
      task: 'erfassen',
      fields: { art: 'Art', hoehe_m: 'Höhe (m)' },
      geometry: { field: 'geometrie', x: 'lon', y: 'lat' },
      sourceCrs: 'EPSG:4326',
      constants: { stage: 'erfasst' },
      delimiter: ';',
    });
    expect(screen.getByTestId('import-ready').textContent).toContain('2 Zeilen sind bereit zum Import.');
    expect(screen.getByTestId('import-preview').textContent).toContain('Eiche');
    expect(screen.getByTestId('import-preview').textContent).toContain('7.10000, 50.10000');
    expect(screen.getByTestId('import-problems').textContent).toContain('Zeile 3');
    expect(screen.getByTestId('import-problems').textContent).toContain('Wert passt nicht');
    expect(screen.getByText(/Regeln und Berechtigungen der Aufgabe prüft erst der Import/)).toBeTruthy();
  });

  it('all-or-nothing is blocked while rows have problems; skipping them imports and shows the progress result', async () => {
    const c = open(true);
    await toPreview(c);
    expect((screen.getByTestId('import-start') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nichts importiert, solange Zeilen Probleme haben/)).toBeTruthy();
    await userEvent.click(
      screen.getByLabelText('Fehlerhafte Zeilen überspringen und die übrigen importieren'),
    );
    await userEvent.click(screen.getByTestId('import-start'));
    expect((await screen.findByTestId('import-result', {}, { timeout: 5000 })).textContent).toContain(
      'CSV erfolgreich importiert (2)',
    );
    const start = need(c.calls.find((x) => x.url.endsWith('/muster/import')));
    const body = need(start.init).body as FormData;
    expect(body.get('mode')).toBe('skip');
    expect(body.get('replace')).toBe('false');
    await waitFor(() => expect(c.ondone).toHaveBeenCalled());
  });

  it('"Alle vorhandenen Daten ersetzen" warns, forces all-or-nothing and sends replace', async () => {
    const c = open(true, { clean: true });
    await upload('Art;lat;lon\nEiche;50.1;7.1\n');
    await userEvent.click(await screen.findByTestId('import-next'));
    await screen.findByTestId('import-ready');
    await userEvent.click(screen.getByLabelText('Alle vorhandenen Daten ersetzen (sonst anhängen)'));
    expect(screen.getByTestId('import-replace-warning')).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          'Fehlerhafte Zeilen überspringen und die übrigen importieren',
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByTestId('import-start'));
    await screen.findByTestId('import-result', {}, { timeout: 5000 });
    const body = need(need(c.calls.find((x) => x.url.endsWith('/muster/import'))).init).body as FormData;
    expect(body.get('replace')).toBe('true');
    expect(body.get('mode')).toBe('atomic');
  });
});

describe('a type that was never published (owner A4)', () => {
  it('explains the import after Veröffentlichen, publishes first, then imports', async () => {
    const c = open(false);
    await upload();
    await userEvent.click(await screen.findByTestId('import-next'));
    expect(await screen.findByTestId('import-unpublished')).toBeTruthy();
    expect(c.calls.some((x) => x.url.endsWith('/import/plan'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Veröffentlichen und importieren' }));
    expect((await screen.findByTestId('import-result', {}, { timeout: 5000 })).textContent).toContain(
      'CSV erfolgreich importiert',
    );
    const deploy = c.calls.findIndex((x) => x.url.endsWith('/deploy'));
    const start = c.calls.findIndex((x) => x.url.endsWith('/muster/import'));
    expect(deploy).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(deploy);
    expect(c.onpublished).toHaveBeenCalled();
  });

  async function publishAndImport(over: Over): Promise<ReturnType<typeof open>> {
    const c = open(false, over);
    await upload();
    await userEvent.click(await screen.findByTestId('import-next'));
    await userEvent.click(await screen.findByRole('button', { name: 'Veröffentlichen und importieren' }));
    return c;
  }
  const sent = (c: { calls: Call[] }, end: string): Call | undefined =>
    c.calls.find((x) => x.url.endsWith(end));

  it('a deploy that needs a value move (409) stops: no import, the builder link shows', async () => {
    const c = await publishAndImport({
      deploy: json(409, { ok: false, reason: 'mapping_required', paths: ['x'] }),
    });
    expect(await screen.findByText(adminMessage('de', 'import_needs_mapping'))).toBeTruthy();
    expect(screen.getByRole('link', { name: adminMessage('de', 'draft_open_builder') })).toBeTruthy();
    expect(JSON.parse(String(need(sent(c, '/deploy')).init?.body))).toMatchObject({
      mappings: {},
      versions: {},
    });
    expect(sent(c, '/muster/import')).toBeUndefined();
    expect(c.onpublished).not.toHaveBeenCalled();
  });

  it('a deploy with problems (422) stops: the count and the builder link show, no import', async () => {
    const c = await publishAndImport({
      deploy: json(422, { ok: false, reason: 'problems', problems: [{ path: 'a' }, { path: 'b' }] }),
    });
    expect(await screen.findByText(adminMessage('de', 'draft_problems_other', { count: 2 }))).toBeTruthy();
    expect(screen.getByRole('link', { name: adminMessage('de', 'draft_open_builder') })).toBeTruthy();
    expect(sent(c, '/muster/import')).toBeUndefined();
  });

  it('a project the server reports as already published is not deployed from here', async () => {
    const c = await publishAndImport({ status: { neverPublished: false } });
    expect(await screen.findByText(adminMessage('de', 'deploy_failed'))).toBeTruthy();
    expect(sent(c, '/deploy')).toBeUndefined();
    expect(sent(c, '/muster/import')).toBeUndefined();
  });
});
