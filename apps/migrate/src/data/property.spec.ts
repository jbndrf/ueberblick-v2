/** Property test: for any v3 log, each property's history in v4 is the recorded order of v3, with its phenomenon times. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runMigration, type V3DataExport, type V3LogRow } from './index';
import { history, world } from './testing';

const FIELDS = ['vitalitaet', 'hoehe_m', 'befund'] as const;
const MIN = 60_000;
const T0 = Date.parse('2025-01-01T00:00:00.000Z');
const stamp = (ms: number): string => new Date(ms).toISOString().replace('T', ' ');

const value = (field: (typeof FIELDS)[number]) =>
  field === 'vitalitaet'
    ? fc.integer({ min: 0, max: 4 }).map(String)
    : field === 'hoehe_m'
      ? fc.integer({ min: 0, max: 60 }).map(String)
      : fc.constantFrom('Stämmling', 'Stämmling', 'Ast', 'Fäulnis', 'Fäulnis');

const step = fc.record({
  fields: fc.uniqueArray(fc.constantFrom(...FIELDS), { minLength: 1, maxLength: 3 }),
  offline: fc.integer({ min: 0, max: 3 * 24 * 60 }),
  observer: fc.constantFrom('anna', 'bernd', 'clara'),
  values: fc.tuple(value('vitalitaet'), value('hoehe_m'), value('befund')),
});

const instance = fc.record({
  steps: fc.array(step, { minLength: 1, maxLength: 5 }),
  order: fc.integer({ min: 0, max: 1_000_000 }),
});

/** The rows of an instance in insertion order; `order` shuffles the array, the recording times keep the truth. */
function rows(subs: readonly (typeof step extends fc.Arbitrary<infer T> ? T : never)[]): V3LogRow[] {
  return subs.flatMap((s, i) =>
    s.fields.map((field): V3LogRow => {
      const recorded = T0 + i * 24 * 60 * MIN;
      return {
        field,
        value: s.values[FIELDS.indexOf(field)],
        observer: s.observer,
        observedAt: stamp(recorded - s.offline * MIN),
        recordedAt: stamp(recorded),
        run: `s${i}`,
      };
    }),
  );
}

function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('history property', () => {
  it(
    'keeps the recorded order and the phenomenon times of every property',
    { timeout: 120_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(instance, async (inst) => {
          const log = rows(inst.steps);
          const v3: V3DataExport = {
            format: 1,
            users: [],
            tableRows: [],
            instances: [
              {
                id: 'x',
                workflow: 'baum',
                createdAt: stamp(T0),
                geometry: { type: 'Point', coordinates: [7.6, 51.9] },
                log: shuffled(log, inst.order),
              },
            ],
          };
          const w = world();
          const r = await runMigration(w.store, v3, w.converted.mapping, {
            target: w.target,
            geo: w.geo,
            configVersion: w.configVersion,
            batchSize: 2,
          });
          expect(r.problems.filter((p) => p.code === 'refused')).toEqual([]);
          const id = r.ids.get('x') as string;
          const all = history(w.db, id);
          for (const field of FIELDS) {
            const want = log
              .filter((l) => l.field === field)
              .map((l) => [
                field === 'vitalitaet'
                  ? `v${String(l.value)}`
                  : field === 'hoehe_m'
                    ? Number(l.value)
                    : String(l.value).normalize('NFC'),
                new Date(`${(l.observedAt as string).replace(' ', 'T')}`).toISOString(),
              ]);
            const got = all.filter((h) => h.property === field).map((h) => [h.result, h.time]);
            expect(got).toEqual(want);
          }
        }),
        { numRuns: Number(process.env['FC_RUNS'] ?? 30) },
      );
    },
  );
});
