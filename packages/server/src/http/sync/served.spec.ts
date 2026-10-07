// WP-163: sync.served is emitted once per served page, with declared fields only.
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { expectDeclaredFieldsOnly } from '../../store/run/log.testkit';
import { setupHttp } from './testkit';

const call = (
  h: ReturnType<typeof setupHttp>,
  q: string,
  who: ReturnType<typeof setupHttp>['anna'] | null = h.anna,
) =>
  h.handlers.sync({
    request: new Request(`http://x/api/p/demo/sync?${q}`),
    project: 'demo',
    principal: who,
  });

describe('sync.served', () => {
  it('one line per served page, with actor, tuple count and duration', () => {
    const h = setupHttp();
    expect(call(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`).status).toBe(200);
    const lines = h.logs.only('sync.served');
    expect(lines).toHaveLength(1);
    const page = h.ctx.service.page(h.annaActor, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION });
    expect(lines[0]).toMatchObject({
      actor: 'anna',
      level: 'info',
      tuples: page.features.length + page.edges.length + page.observations.length + page.tombstones.length,
    });
    expect(typeof lines[0]?.['requestId']).toBe('string');
    expect(typeof lines[0]?.['ms']).toBe('number');
    expectDeclaredFieldsOnly(h.logs.lines());
  });

  it('a second page is a second line with another request id', () => {
    const h = setupHttp();
    call(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`);
    call(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`);
    const ids = h.logs.only('sync.served').map((l) => l['requestId']);
    expect(new Set(ids).size).toBe(2);
  });

  it('nothing is logged for a refused caller or a bad request', () => {
    const h = setupHttp();
    expect(call(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`, null).status).toBe(401);
    expect(call(h, 'since=x').status).toBeGreaterThanOrEqual(400);
    expect(h.logs.only('sync.served')).toEqual([]);
  });
});
