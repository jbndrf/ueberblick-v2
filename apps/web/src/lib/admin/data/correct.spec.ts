// WP-370: what the data page sends as one Admin-Korrektur, and how an answer comes back to the table.
import { RowRefusal } from '@ueberblick/ui/components/admin';
import { describe, expect, it, vi } from 'vitest';
import { correctUrl, correctionValues, submitCorrection, type CorrectTexts } from './correct';
import { buildColumns, type ColumnsInput } from './columns';
import { rowUrl } from './query';

const type = {
  label: { de: 'Baum' },
  geometry: 'geo',
  process: { property: 'stage', start: 'neu', end: ['fertig'] },
  properties: {
    stage: {
      type: 'select',
      label: { de: 'Stufe' },
      options: { neu: { de: 'Neu' }, fertig: { de: 'Fertig' } },
    },
    vit: { type: 'select', label: { de: 'Vitalität' }, options: { v1: { de: 'Eins' }, v2: { de: 'Zwei' } } },
    tags: { type: 'multiselect', label: { de: 'Tags' }, options: { a: { de: 'A' }, b: { de: 'B' } } },
    hoehe: { type: 'number', label: { de: 'Höhe' } },
    anzahl: { type: 'integer', label: { de: 'Anzahl' } },
    note: { type: 'text', label: { de: 'Notiz' } },
    wann: { type: 'datetime', label: { de: 'Wann' } },
    tag: { type: 'date', label: { de: 'Tag' } },
    ok: { type: 'boolean', label: { de: 'OK' } },
    wer: { type: 'participant', label: { de: 'Wer' } },
    desc: { type: 'localized_text', label: { de: 'Beschreibung' } },
    foto: { type: 'file', label: { de: 'Foto' } },
    ref: { type: 'reference', to: 'x', label: { de: 'Ref' } },
    geo: { type: 'geometry', geometry_type: 'point', label: { de: 'Ort' } },
  },
} as unknown as ColumnsInput['type'];
const input: ColumnsInput = {
  type,
  locale: 'de',
  names: {},
  actors: { system: 'System', importBy: (a) => `Import (${a})` },
  labels: {
    status: 's',
    stage: 'Stufe',
    createdBy: 'c',
    location: 'l',
    created: 'cr',
    yes: 'Ja',
    no: 'Nein',
  },
};
const cols = buildColumns(input);
const col = (key: string) => cols.find((c) => c.key === key);

describe('data page columns in Bearbeitungsmodus', () => {
  it('property columns of the kinds the cells can edit are editable', () => {
    for (const key of ['vit', 'tags', 'hoehe', 'anzahl', 'note', 'wann', 'tag', 'ok'])
      expect(col(key)?.editable, key).toBe(true);
  });

  it('the stage, system columns and the kinds without a cell editor are read-only', () => {
    for (const key of [
      'stage',
      '$lifecycle',
      '$created_by',
      '$created_at',
      '$location',
      'wer',
      'desc',
      'foto',
      'ref',
    ])
      expect(col(key)?.editable, key).not.toBe(true);
  });
});

describe('correctionValues', () => {
  it('turns cell values back into property values', () => {
    expect(
      correctionValues(type, {
        vit: ['v2'],
        tags: ['a', 'b'],
        hoehe: 4.5,
        note: 'x',
        wann: '2026-05-01T10:30',
        tag: '2026-05-01',
        ok: true,
      }),
    ).toEqual({
      vit: 'v2',
      tags: ['a', 'b'],
      hoehe: 4.5,
      note: 'x',
      wann: new Date('2026-05-01T10:30').toISOString(),
      tag: '2026-05-01',
      ok: true,
    });
  });

  it('an emptied cell clears the property', () => {
    expect(correctionValues(type, { vit: [], hoehe: '', note: '', tag: '', wann: '' })).toEqual({
      vit: null,
      hoehe: null,
      note: null,
      tag: null,
      wann: null,
    });
  });
});

const texts: CorrectTexts = {
  stale: 'stale',
  failed: 'failed',
  refused: (property, reason) => `${property}: ${reason}`,
  label: (key) => (key === 'hoehe' ? 'Höhe' : key),
};
const reply = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('submitCorrection', () => {
  it('posts one body with all values and the row seq', async () => {
    const fetchMock = vi.fn(reply(200, { runId: 'r', seq: 7 }));
    await submitCorrection(fetchMock, 'demo', 'f1', { note: 'x', hoehe: 2 }, 5, texts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(correctUrl('demo', 'f1'));
    expect(url).toBe('/api/admin/p/demo/features/f1/correct');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ values: { note: 'x', hoehe: 2 }, expected_seq: 5 });
  });

  it('a refusal names the cell by its property', async () => {
    const issue = { path: 'input.values.hoehe', message: 'wrong' };
    const body = { error: { code: 'run_refused', message: 'wrong', issues: [issue] } };
    const err = await submitCorrection(reply(422, body), 'demo', 'f1', { hoehe: 'x' }, 5, texts).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(RowRefusal);
    expect(err.reasons).toEqual({ hoehe: 'wrong' });
    expect(err.message).toBe('Höhe: wrong');
  });

  it('a stale row is a refusal without a cell; other failures are plain errors', async () => {
    const stale = await submitCorrection(
      reply(409, { error: { code: 'conflict' } }),
      'd',
      'f',
      { a: 1 },
      1,
      texts,
    ).catch((e) => e);
    expect(stale).toBeInstanceOf(RowRefusal);
    expect(stale.reasons).toEqual({});
    expect(stale.message).toBe('stale');
    const down = await submitCorrection(reply(500, {}), 'd', 'f', { a: 1 }, 1, texts).catch((e) => e);
    expect(down).not.toBeInstanceOf(RowRefusal);
  });
});

describe('rowUrl', () => {
  it('asks for one row in any lifecycle state', () => {
    const url = new URL(rowUrl('demo', 'baum', 'f1'), 'http://x');
    expect(url.pathname).toBe('/api/admin/p/demo/features');
    expect(url.searchParams.get('type')).toBe('baum');
    expect(url.searchParams.get('filter.$id')).toBe('f1');
    expect(url.searchParams.get('lifecycle')).toBe('active,completed,archived,deleted');
  });
});
