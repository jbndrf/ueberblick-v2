/**
 * WP-841: a run the planner can judge never answers 500. Whatever a participant sends, the endpoint answers 200
 * (accepted), 422 (refused) or 409 (review), with the typed envelope the client queue settles on.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core';
import { HookFailed, NoDeployedVersion, type Store } from '../../store';
import { createDoorbell, withDoorbell, type DoorbellMessage } from '../../sync/doorbell';
import { anna, uuid } from '../../store/run/testkit';
import { expectDeclaredFieldsOnly } from '../../store/run/log.testkit';
import { world } from './runs.testkit';

let n = 0;
const rid = (): string => uuid(8, ++n);
const point = (x: number, y = 50.735) => ({ type: 'Point', coordinates: [x, y] });
const erfassen = () => ({
  id: rid(),
  task: 'erfassen',
  configVersion: 1,
  input: { geometrie: point(7.1 + n * 0.0001), vitalitaet: 'v2' },
});
const SETTLED = [200, 409, 422];

describe('the runs endpoint never throws for a run the planner can judge', () => {
  it('a move of a feature that does not exist, or twice, is judged', async () => {
    const w = await world();
    const cookie = w.cookies.anna;
    const ghost = uuid(0, 424242);
    for (const featureId of [ghost, undefined]) {
      const r = await w.call(
        'submit',
        { id: rid(), task: 'verschieben', configVersion: 1, featureId, input: { geometrie: point(7.2) } },
        { cookie },
      );
      expect(SETTLED).toContain(r.status);
    }
    const made = erfassen();
    const created = (await (await w.call('submit', made, { cookie })).json()) as {
      observations: { featureId: string }[];
    };
    const featureId = created.observations[0]?.featureId;
    for (let i = 0; i < 3; i++) {
      const r = await w.call(
        'submit',
        { id: rid(), task: 'verschieben', configVersion: 1, featureId, input: { geometrie: point(7.3 + i) } },
        { cookie },
      );
      expect(SETTLED).toContain(r.status);
    }
  });

  it('property: any geometry in a move input is judged, never a 500', async () => {
    const w = await world();
    const cookie = w.cookies.anna;
    const made = (await (await w.call('submit', erfassen(), { cookie })).json()) as {
      observations: { featureId: string }[];
    };
    const featureId = made.observations[0]?.featureId;
    const coord = fc.oneof(fc.double({ noNaN: true }), fc.constantFrom(0, 1e308, -1e308, 181, 91));
    const geometry = fc.oneof(
      fc.record({ type: fc.constant('Point'), coordinates: fc.array(coord, { maxLength: 4 }) }),
      fc.record({
        type: fc.constantFrom('LineString', 'Polygon', 'MultiPoint', 'Nope'),
        coordinates: fc.array(fc.array(coord, { maxLength: 3 }), { maxLength: 4 }),
      }),
      fc.jsonValue(),
    );
    await fc.assert(
      fc.asyncProperty(geometry, async (g) => {
        const r = await w.call(
          'submit',
          { id: rid(), task: 'verschieben', configVersion: 1, featureId, input: { geometrie: g } },
          { cookie },
        );
        expect([...SETTLED, 400]).toContain(r.status);
      }),
      { numRuns: 300 },
    );
  });
});

describe('a store that throws is answered, and named in the log', () => {
  const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
  const throwing =
    (make: () => Error) =>
    (real: Store): Store => ({
      ...real,
      submit: () => {
        throw make();
      },
      submitBatch: () => {
        throw make();
      },
    });

  it('SQLITE_BUSY is a retryable 503 with the protocol version, and a repeat can still be accepted', async () => {
    const w = await world(undefined, throwing(busy));
    for (const which of ['submit', 'batch'] as const) {
      const body = which === 'submit' ? erfassen() : { runs: [erfassen()] };
      const r = await w.call(which, body, { cookie: w.cookies.anna });
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ v: SYNC_PROTOCOL_VERSION, error: { code: 'busy' } });
    }
    expect(w.logs.only('run.failed').map((l) => l['code'])).toEqual(['SQLITE_BUSY', 'SQLITE_BUSY']);
  });

  it('no deployed config version is a 409 conflict, not a 500', async () => {
    const w = await world(
      undefined,
      throwing(() => new NoDeployedVersion()),
    );
    const r = await w.call('submit', erfassen(), { cookie: w.cookies.anna });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ v: SYNC_PROTOCOL_VERSION, error: { code: 'conflict' } });
  });

  it('any other throw stays a 500, but the log names its kind (handleError logs no message)', async () => {
    const w = await world(
      undefined,
      throwing(() => new TypeError('boom')),
    );
    await expect(w.call('submit', erfassen(), { cookie: w.cookies.anna })).rejects.toThrow('boom');
    expect(w.logs.only('run.failed')).toMatchObject([{ code: 'TypeError', level: 'error' }]);
    expectDeclaredFieldsOnly(w.logs.lines());
  });

  it('a failing timers hook is a 500 named hook_timers in the log, not a refusal (WP-860; a busy one is the SQLITE_BUSY 503 above)', async () => {
    const w = await world(
      undefined,
      throwing(() => new HookFailed('timers', new TypeError('boom'))),
    );
    await expect(w.call('submit', erfassen(), { cookie: w.cookies.anna })).rejects.toThrow(HookFailed);
    expect(w.logs.only('run.failed')).toMatchObject([{ code: 'hook_timers', level: 'error' }]);
    expectDeclaredFieldsOnly(w.logs.lines());
  });

  it('a failing doorbell listener after the commit does not break the answer or the other listeners', async () => {
    const w = await world();
    let head = 0;
    const bell = createDoorbell({ head: () => head++, pollMs: 0 });
    bell.subscribe(() => {
      throw new Error('stream closed');
    });
    const heard: number[] = [];
    bell.subscribe((m: DoorbellMessage) => heard.push(m.to));
    const store = withDoorbell(w.ctx.store, bell);
    const run = w.ctx.run('erfassen', anna, { geometrie: point(7.1), vitalitaet: 'v2' });
    expect(store.submit(run).outcome).toBe('accepted');
    expect(heard).toHaveLength(1);
  });

  it('a batch failure logs the batch size with the first run id', async () => {
    const w = await world(
      undefined,
      throwing(() => new TypeError('boom')),
    );
    await expect(
      w.call('batch', { runs: [erfassen(), erfassen(), erfassen()] }, { cookie: w.cookies.anna }),
    ).rejects.toThrow('boom');
    await expect(w.call('submit', erfassen(), { cookie: w.cookies.anna })).rejects.toThrow('boom');
    expect(w.logs.only('run.failed').map((l) => l['size'])).toEqual([3, 1]);
    expectDeclaredFieldsOnly(w.logs.lines());
  });
});
