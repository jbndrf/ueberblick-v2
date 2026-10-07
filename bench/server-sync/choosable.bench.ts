/**
 * Budget (WP-725 fix round, R14): the choosable list costs one scan of `participants` per pull, only for a caller in
 * some `select.all`. At 500 participants an empty delta (the device holds the current set, so no list is sent) stays
 * within the "empty delta p95 <= 10 ms" row of docs/12 (median of 40). Derived, not a table row.
 * Run: npm test -- -c bench/vitest.config.ts bench/server-sync/choosable
 */
import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION, choosableHash } from '../../packages/core/src';
import { build } from '../../packages/server/src/store/run/testkit';
import { scopedConfig, syncSetup, vera } from '../../packages/server/src/sync/testkit';
import { defineBudget, report } from '../harness/budget.mjs';

function config() {
  const file = scopedConfig().file;
  const baum = file.types?.['baum'];
  const zustaendig = baum?.properties['zustaendig'];
  if (baum === undefined || zustaendig === undefined) throw new Error('golden template has no baum.zustaendig');
  const properties = { ...baum.properties, zustaendig: { ...zustaendig, select: { all: ['verwaltung'] } } };
  return build({ ...file, types: { ...file.types, baum: { ...baum, properties } } });
}

describe('bench: choosable participants on a pull', () => {
  it('an empty delta at 500 participants stays within 10 ms (median of 40)', () => {
    const ctx = syncSetup(config());
    const put = ctx.db.prepare('INSERT INTO participants (id, name, roles, disabled_at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 500; i++) put.run(`p${i}`, `Person ${i}`, '[]', null);
    const first = ctx.service.page(vera, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION });
    const held = first.header.choosable;
    expect(held).toBe(choosableHash(first.people.filter((p) => p.choosable === true)));
    const req = {
      since: ctx.service.head(),
      scope: first.header.scopeFingerprint,
      v: SYNC_PROTOCOL_VERSION,
      ...(held === undefined ? {} : { choosable: held }),
    };
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const page = ctx.service.page(vera, req);
      samples.push(performance.now() - t0);
      expect(page.header.choosable).toBeUndefined();
    }
    samples.sort((a, b) => a - b);
    const median = samples[20] as number;
    const listBytes = JSON.stringify(first.people).length;
    console.info(`choosable: ${median.toFixed(2)} ms empty delta at 500 participants, list ${listBytes} bytes`);
    report(
      defineBudget({
        id: 'server-sync-choosable-500',
        limit: 10,
        unit: 'ms',
        derivedFrom: 'empty-delta-p95: the choosable scan and hash for a select.all caller at 500 participants',
        device: 'server',
      }),
      Number(median.toFixed(2)),
    );
  });
});
