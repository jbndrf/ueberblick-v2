/**
 * The OGC write check plans a feature under its own config version (A-029, WP-316): with v2 deployed, a feature pinned
 * to v1 may run v1's delete task, a floating one has none. The check is `plan.availableFor` with the sync service's
 * `ConfigResolver`; no one-version adapter.
 */
import { describe, expect, it } from 'vitest';
import { IDS, build, golden } from '../../store/run/testkit';
import { ogcWorld } from './testkit';

const v1 = () => {
  const file = structuredClone(golden('musterstadt-plain').file);
  file.tasks = {
    ...file.tasks,
    entfernen: { label: { de: 'Entfernen' }, on: 'baum', then: [{ lifecycle: 'deleted' }] },
  };
  return build(file);
};
const world = () =>
  ogcWorld({ config: v1(), versions: { configs: new Map([[2, golden('musterstadt-plain')]]), deployed: 2 } });

describe('OGC DELETE under the version of the feature', () => {
  it('a feature pinned to v1 runs the delete task v1 has and v2 lacks; the run is stamped v1', async () => {
    const w = await world();
    w.ctx.pin(IDS.t_in, 1);
    expect((await w.send('DELETE', `/collections/baum/items/${IDS.t_in}`)).status).toBe(204);
    const run = w.ctx.db
      .prepare<{ task: string; config_version: number }>(
        "SELECT task, config_version FROM runs WHERE actor_kind = 'admin' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    expect(run).toEqual({ task: 'entfernen', config_version: 1 });
  });

  it('a floating feature follows v2, which has no delete task: 422', async () => {
    const w = await world();
    const r = await w.send('DELETE', `/collections/baum/items/${IDS.t_out}`);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('no_write_task');
  });
});
