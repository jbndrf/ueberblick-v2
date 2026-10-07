/** After any interleaving of server writes, removals, scope changes, crashes and pulls, a final pull converges to the server. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SyncResetReason } from '@ueberblick/core/registry';
import { fakeEnv } from '../store/test-env';
import { HOST_KINDS, type HostKind } from '../host/kinds';
import { openTestHost } from '../host/test-hosts';
import { FakeServer, memoryMeta } from './test-server';

const op = fc.oneof(
  fc.record({ t: fc.constant('write' as const), n: fc.integer({ min: 1, max: 12 }) }),
  fc.record({ t: fc.constant('remove' as const), n: fc.integer({ min: 1, max: 12 }) }),
  fc.record({ t: fc.constant('pull' as const), n: fc.constant(0) }),
  fc.record({ t: fc.constant('crash' as const), n: fc.constant(0) }),
  fc.record({ t: fc.constant('scope' as const), n: fc.constant(0) }),
);

type Op = { readonly t: 'write' | 'remove' | 'pull' | 'crash' | 'scope'; readonly n: number };

async function converges(kind: HostKind, ops: readonly Op[], size: number): Promise<void> {
  const server = new FakeServer();
  server.pageSize = size;
  const env = fakeEnv();
  const meta = memoryMeta();
  const rederived: SyncResetReason[] = [];
  const open = async () => {
    const host = await openTestHost(kind, { transport: server, env, meta, rederived });
    return { host, store: host.store, worker: host.sync };
  };
  let cur = await open();
  let scopeN = 0;
  for (const o of ops) {
    if (o.t === 'write') server.write(o.n, { v: server.seq });
    else if (o.t === 'remove') server.remove(o.n);
    else if (o.t === 'scope') server.scope = `s${++scopeN}`;
    else if (o.t === 'pull') await cur.worker.pull();
    else {
      server.failOn = (n) => (n === 1 ? new Error('crash') : undefined);
      await cur.worker.pull().catch(() => undefined);
      server.failOn = undefined;
      cur.host.dispose();
      cur = await open();
    }
  }
  await cur.worker.pull();
  await cur.worker.pull();
  const expected = [...server.features.values()].map((f) => f.id).sort();
  expect(cur.store.featureIdsOfType('tree').slice().sort()).toEqual(expected);
  for (const f of server.features.values())
    expect(cur.store.facts.feature(f.id)).toEqual({ ...f, version: 1 }); // the row version of protocol 3 is stored with the feature
}

describe.each(HOST_KINDS)('sync convergence on the %s host', (kind) => {
  it('the store equals the server after a final pull', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 30 }), fc.integer({ min: 1, max: 4 }), (ops, size) =>
        converges(kind, ops, size),
      ),
      { numRuns: 60 },
    );
  });

  // Found by 4000 runs (seed 141146482): a crash between snapshot pages, then a removal. The resumed
  // snapshot must not skip a feature that shifted into the already-sent offset range.
  it('a snapshot resumed after a crash and a removal still delivers every feature', async () => {
    const ops: Op[] = [
      { t: 'write', n: 8 },
      { t: 'write', n: 9 },
      { t: 'crash', n: 0 },
      { t: 'remove', n: 8 },
    ];
    await converges(kind, ops, 1);
  });
});
