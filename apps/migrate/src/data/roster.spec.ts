/** WP-168 acceptance: a migrated project has its roster, and a role-gated task accepts a migrated participant. */
import { describe, expect, it } from 'vitest';
import type { Actor, Key, RunId } from '@ueberblick/core';
import { participantRolesOf } from '@ueberblick/server';
import { fillRoster, readDataExport, runMigration } from './index';
import { loadData, world } from './testing';

const exportWith = (users: unknown) => readDataExport({ ...(loadData('baumkontrolle') as object), users });

const actorOf = (db: Parameters<typeof participantRolesOf>[0], id: string): Actor => ({
  id,
  kind: 'participant',
  roles: [...(participantRolesOf(db, id) ?? [])] as Key[],
});

describe('migration roster', () => {
  it('reads users (ids and roles); a malformed or repeated user names its place', () => {
    const ok = exportWith([{ id: 'anna', roles: ['kontrolle'], email: 'a@b.de', name: 'Anna' }]);
    expect(ok.users).toEqual([{ id: 'anna', roles: ['kontrolle'] }]);
    expect(() => exportWith([{ roles: [] }])).toThrowError(/users\.0\.id/);
    expect(() => exportWith([{ id: 'a', roles: [3] }])).toThrowError(/users\.0\.roles/);
    expect(() =>
      exportWith([
        { id: 'a', roles: [] },
        { id: 'a', roles: [] },
      ]),
    ).toThrowError(/twice/);
  });

  it('runMigration with `roster` fills the roster; a role-gated task accepts the migrated participant', async () => {
    const w = world();
    const data = exportWith([
      { id: 'anna', roles: ['verwaltung'] },
      { id: 'bernd', roles: ['kontrolle', 'gone'] },
    ]);
    const r = await runMigration(w.store, data, w.converted.mapping, {
      target: w.target,
      geo: w.geo,
      configVersion: w.configVersion,
      roster: w.db,
    });
    expect(r.problems.filter((p) => p.code === 'unknown_role')).toEqual([
      expect.objectContaining({ record: 'bernd' }),
    ]);
    expect(participantRolesOf(w.db, 'anna')).toEqual(['verwaltung']);
    expect(participantRolesOf(w.db, 'bernd')).toEqual(['kontrolle']);

    // `anlegen` is offered to 'verwaltung' only.
    const submit = (n: number, actor: Actor) =>
      w.store.submit({
        id: `bbbbbbbb-0000-7000-8000-00000000020${n}` as RunId,
        task: 'anlegen' as Key,
        actor,
        configVersion: w.configVersion,
        input: {
          geom: {
            type: 'Polygon',
            coordinates: [
              [
                [7, 51],
                [7.001, 51],
                [7.001, 51.001],
                [7, 51],
              ],
            ],
          },
          name: 'Neu',
        },
      });
    const first = submit(1, actorOf(w.db, 'anna'));
    expect(first.outcome === 'refused' ? first.refusal : 'accepted').toBe('accepted');
    expect(submit(2, actorOf(w.db, 'bernd')).outcome).toBe('refused');
    // Not in the roster: no roles (A-014), refused.
    expect(submit(3, actorOf(w.db, 'ghost')).outcome).toBe('refused');
  });

  it('fillRoster can run again: it replaces the roles of a known id', () => {
    const w = world();
    const m = w.converted.mapping;
    expect(fillRoster(w.db, [{ id: 'anna', roles: ['kontrolle'] }], m).filled).toBe(1);
    expect(fillRoster(w.db, [{ id: 'anna', roles: ['bauhof'] }], m).filled).toBe(0);
    expect(participantRolesOf(w.db, 'anna')).toEqual(['bauhof']);
  });
});
