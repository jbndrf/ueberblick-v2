/** WP-756: a `select.all` role may not choose a non-member through OGC write either (plan refuses, 403). */
import type { Key } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { isAuthError } from '../../auth';
import { IDS } from '../../store/run/testkit';
import { ogcWorld } from './testkit';

const patch = (properties: Record<string, unknown>) => ({ type: 'Feature', geometry: null, properties });
const path = `/collections/baum/items/${IDS.t_in}?task=zuweisen`;

describe('OGC write checks who may be chosen (WP-756)', () => {
  it('refuses a participant id that is no member, accepts a member', async () => {
    const w = await ogcWorld({ annaRoles: ['verwaltung' as Key] });
    const issued = w.auth.apiTokens.issue('p1', 'anna', { label: 'QGIS' });
    if (isAuthError(issued)) throw new Error(issued.code);
    const auth = { authorization: `Bearer ${issued.token}` };
    w.ctx.db
      .prepare("INSERT OR IGNORE INTO participants (id, name, roles) VALUES ('anna', NULL, '[]')")
      .run();
    const ghost = await w.send('PATCH', path, patch({ zustaendig: 'ghost' }), '', auth);
    expect(ghost.status).toBe(403);
    const ok = await w.send('PATCH', path, patch({ zustaendig: 'anna' }), '', auth);
    expect(ok.status).toBe(204);
  });
});
