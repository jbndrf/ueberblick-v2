// WP-793: the pull header may carry an `access` value; it is optional and additive.
import { describe, expect, it } from 'vitest';
import { decodePage, encodePage } from './codec';
import type { SyncPage } from './contract';

const page = (access?: string): SyncPage => ({
  header: {
    kind: 'delta',
    cursor: 1,
    head: 1,
    more: false,
    scopeFingerprint: 'abc',
    versions: { deployed: 1, live: [1] },
    ...(access === undefined ? {} : { access }),
  },
  features: [],
  edges: [],
  observations: [],
  tombstones: [],
  runs: [],
  people: [],
});

describe('access on the wire', () => {
  it('round-trips the header field', () => {
    const wire: unknown = JSON.parse(JSON.stringify(encodePage(page('h1'))));
    expect(decodePage(wire).header.access).toBe('h1');
  });
  it('an older server without the field decodes without it', () => {
    const wire: unknown = JSON.parse(JSON.stringify(encodePage(page())));
    expect('access' in decodePage(wire).header).toBe(false);
  });
});
