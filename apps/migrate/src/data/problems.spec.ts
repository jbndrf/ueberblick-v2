/** What the conversion does with data it cannot carry: it reports, and everything else still goes through. */
import { describe, expect, it } from 'vitest';
import { runMigration, type V3DataExport } from './index';
import { snapshot, world } from './testing';

const point = { type: 'Point', coordinates: [7.6, 51.9] };
const row = (field: string, value: unknown, at: string, run: string) => ({
  field,
  value,
  recordedAt: at,
  run,
});

async function migrateOf(x: Partial<V3DataExport>, batchSize = 10) {
  const w = world();
  const r = await runMigration(
    w.store,
    { format: 1, users: [], instances: [], tableRows: [], ...x },
    w.converted.mapping,
    {
      target: w.target,
      geo: w.geo,
      configVersion: w.configVersion,
      batchSize,
    },
  );
  return { w, r };
}

describe('problems', () => {
  it('a run the store refuses costs that run, not the batch', async () => {
    const x: Partial<V3DataExport> = {
      instances: [
        {
          id: 'good',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [
            row('hoehe_m', '12', '2025-01-01 10:00:00Z', 's1'),
            row('hoehe_m', '13', '2025-02-01 10:00:00Z', 's2'),
          ],
        },
        // the maximum of the property is 60
        {
          id: 'bad',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [
            row('hoehe_m', '12', '2025-01-01 10:00:00Z', 's1'),
            row('hoehe_m', '200', '2025-02-01 10:00:00Z', 's2'),
          ],
        },
        {
          id: 'after',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [
            row('hoehe_m', '14', '2025-01-01 10:00:00Z', 's1'),
            row('hoehe_m', '15', '2025-02-01 10:00:00Z', 's2'),
          ],
        },
      ],
    };
    const { w, r } = await migrateOf(x);
    const snap = snapshot(w.db, r.ids);
    expect(snap['good']?.properties['hoehe_m']).toBe(13);
    expect(snap['bad']?.properties['hoehe_m']).toBe(12);
    expect(snap['after']?.properties['hoehe_m']).toBe(15);
    const refused = r.problems.filter((p) => p.code === 'refused');
    expect(refused.map((p) => p.record)).toEqual(['bad']);
  });

  it('a reference to a record that was not converted is reported and left empty', async () => {
    const x = {
      instances: [
        {
          id: 'b',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [row('flaeche_ref', ['gone'], '2025-01-01 10:00:00Z', 's1')],
        },
      ],
    };
    const { w, r } = await migrateOf(x);
    expect(r.problems.map((p) => p.code)).toContain('unresolved_reference');
    expect(snapshot(w.db, r.ids)['b']?.properties['flaeche_ref']).toBeNull();
  });

  it('a single reference that held several records keeps the first and says so', async () => {
    const x = {
      instances: [
        {
          id: 'f1',
          workflow: 'flaeche',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [7, 51],
                [7.1, 51],
                [7.1, 51.1],
                [7, 51],
              ],
            ],
          },
          log: [],
        },
        {
          id: 'f2',
          workflow: 'flaeche',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [8, 51],
                [8.1, 51],
                [8.1, 51.1],
                [8, 51],
              ],
            ],
          },
          log: [],
        },
        {
          id: 'b',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [row('flaeche_ref', ['f2', 'f1'], '2025-01-01 10:00:00Z', 's1')],
        },
      ],
    };
    const { w, r } = await migrateOf(x);
    expect(snapshot(w.db, r.ids)['b']?.properties['flaeche_ref']).toBe('@f2');
    expect(r.problems.map((p) => p.code)).toContain('reference_dropped');
  });

  it('a table selector resolves by row id or by the value of a column', async () => {
    const x = {
      tableRows: [{ id: 'art1', table: 'baumart', values: { name: 'Linde' } }],
      instances: [
        {
          id: 'b1',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [row('art', 'art1', '2025-01-01 10:00:00Z', 's1')],
        },
        {
          id: 'b2',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [row('art', 'Linde', '2025-01-01 10:00:00Z', 's1')],
        },
      ],
    };
    const { w, r } = await migrateOf(x);
    const snap = snapshot(w.db, r.ids);
    expect(snap['b1']?.properties['art']).toBe('@art1');
    expect(snap['b2']?.properties['art']).toBe('@art1');
  });

  it('an option that is not in the project is dropped with a reason, the rest is kept', async () => {
    const x = {
      instances: [
        {
          id: 'b',
          workflow: 'baum',
          geometry: point,
          createdAt: '2025-01-01 10:00:00Z',
          log: [
            row('vitalitaet', '9', '2025-01-01 10:00:00Z', 's1'),
            row('hoehe_m', '7', '2025-01-01 10:00:00Z', 's1'),
            row('unbekannt', 'x', '2025-01-01 10:00:00Z', 's1'),
          ],
        },
      ],
    };
    const { w, r } = await migrateOf(x);
    const props = snapshot(w.db, r.ids)['b']?.properties ?? {};
    expect(props['hoehe_m']).toBe(7);
    expect(props['vitalitaet']).toBeUndefined();
    expect(r.problems.map((p) => p.code).sort()).toEqual(['no_counterpart', 'unknown_field']);
  });

  it('a time that cannot be read is reported; the store stamps its own time (WP-724)', async () => {
    const x = {
      instances: [{ id: 'b', workflow: 'baum', geometry: point, createdAt: 'gestern', log: [] }],
    };
    const { w, r } = await migrateOf(x);
    expect(r.problems.map((p) => p.code)).toContain('bad_time');
    const t = w.db
      .prepare<{ phenomenon_time: string | null }>(
        "SELECT phenomenon_time FROM observations WHERE property = '$type'",
      )
      .get();
    expect(t?.phenomenon_time).not.toBeNull();
  });

  it('a geometry of the wrong kind is reported and the feature is not created', async () => {
    const x = {
      instances: [
        {
          id: 'b',
          workflow: 'baum',
          geometry: {
            type: 'LineString',
            coordinates: [
              [7, 51],
              [7.1, 51.1],
            ],
          },
          log: [],
        },
      ],
    };
    const { r } = await migrateOf(x);
    expect(r.ids.get('b')).toBeUndefined();
    expect(r.problems.map((p) => p.code)).toContain('no_geometry');
  });
});
