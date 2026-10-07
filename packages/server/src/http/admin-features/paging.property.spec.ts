import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { featureHistory, type FeaturePage } from './index';
import { ids, insert, world } from './testkit';

describe('admin feature list: keyset paging property', () => {
  it('walking the pages gives the full sorted list for any data, sort direction and page size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.option(fc.constantFrom('a', 'B', 'b', 'c', ''), { nil: null }), {
          minLength: 0,
          maxLength: 25,
        }),
        fc.constantFrom('asc', 'desc'),
        fc.integer({ min: 1, max: 6 }),
        async (values, dir, limit) => {
          const w = world();
          values.forEach((v, i) => insert(w.db, { id: `r${String(i).padStart(2, '0')}`, befund: v }));
          const seen: string[] = [];
          let next: string | null = null;
          do {
            const page: FeaturePage = await w.list(
              `sort=befund&dir=${dir}&limit=${limit}${next === null ? '' : `&cursor=${next}`}`,
            );
            seen.push(...ids(page));
            next = page.next;
          } while (next !== null);
          const direct = await w.list(`sort=befund&dir=${dir}&limit=500`);
          expect(seen).toEqual(ids(direct));
          expect(seen).toHaveLength(values.length);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('admin feature history: keyset paging property', () => {
  it('walking the pages gives every run of the feature once, newest first, for any size and page size', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('f1', 'f2'), { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 7 }),
        (owners, limit) => {
          const w = world();
          owners.forEach((f, i) =>
            w.db
              .prepare(
                `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, result, feature_id)
                 VALUES (?, 'anna', 'participant', 't', 1, '{}', 'x', 'rejected', '{"refusal":{"code":"c","message":"m"}}', ?)`,
              )
              .run(`run${i}`, f),
          );
          const seen: string[] = [];
          let before: number | undefined;
          for (;;) {
            const page = featureHistory(w.db, 'f1', before, { limit });
            seen.push(...page.runs.map((r) => r.id));
            if (page.next === null) break;
            before = Number(page.next);
          }
          const expected = owners.flatMap((f, i) => (f === 'f1' ? [`run${i}`] : [])).reverse();
          expect(seen).toEqual(expected);
        },
      ),
      { numRuns: 40 },
    );
  });
});
