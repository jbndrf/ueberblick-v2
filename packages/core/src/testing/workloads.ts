/**
 * The default simulation workload: the golden tree cadastre (`musterstadt-plain`) with three roles.
 * Runs are drawn at random from what each role could try, a few on purpose invalid, so refusals happen.
 */
import { compilePerms } from '../perms';
import type { Actor, Json, Key } from '../model';
import type { RunDraft, Workload } from './contract';
import { Aliases, goldenConfig, goldenYaml, seedFeatures, type SeedFeatures } from './golden';
import type { Rng } from './contract';
import type { MemoryStore } from '../memory';

const actor = (kind: Actor['kind'], id: string, roles: readonly string[] = []): Actor => ({
  id,
  kind,
  roles: roles as readonly Key[],
});

const point = (rng: Rng): Json => ({
  type: 'Point',
  coordinates: [7.095 + rng.next() * 0.02, 50.728 + rng.next() * 0.015],
});
const square = (rng: Rng): Json => {
  const x = 7.09 + rng.next() * 0.01;
  const y = 50.72 + rng.next() * 0.01;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + 0.02, y],
        [x + 0.02, y + 0.02],
        [x, y + 0.02],
        [x, y],
      ],
    ],
  };
};
const text = (rng: Rng, stem: string): string => `${stem} ${rng.int(1000)}`;

export function baumWorkload(): Workload {
  const config = goldenConfig('projects/musterstadt-plain.yaml');
  const perms = compilePerms(config);
  const anna = actor('participant', 'anna', ['kontrolle']);
  const bernd = actor('participant', 'bernd', ['bauhof']);
  const vera = actor('participant', 'vera', ['verwaltung']);
  const admin = actor('admin', 'admin');
  const seed = goldenYaml('seeds/musterstadt-geo.yaml') as { features: SeedFeatures };

  const draft = (task: string, who: Actor, input: { [k: string]: Json }, featureId?: string): RunDraft =>
    ({ task: task as Key, actor: who, input, ...(featureId ? { featureId } : {}) }) as RunDraft;

  return {
    config,
    perms,
    participants: [anna, bernd, vera],
    admin,
    seed: (store: MemoryStore) => seedFeatures(store, seed.features, new Aliases()),

    nextRun(rng, view, who): RunDraft | undefined {
      const trees = view.ids('baum');
      const measures = view.ids('massnahme');
      const areas = view.ids('flaeche');
      const tree = trees.length > 0 ? rng.pick(trees) : undefined;
      const bad = rng.chance(0.08);
      const roles = who.roles as readonly string[];
      const options: (() => RunDraft | undefined)[] = [];
      if (roles.includes('kontrolle') || roles.includes('bauhof')) {
        options.push(
          () => tree && draft('befund_ergaenzen', who, bad ? {} : { befund: text(rng, 'Befund') }, tree),
        );
      }
      if (roles.includes('kontrolle')) {
        options.push(
          () =>
            tree &&
            draft(
              'kontrolle',
              who,
              { vitalitaet: rng.pick(['v1', 'v2', 'v3', 'v4']), befund: text(rng, 'Kontrolle') },
              tree,
            ),
        );
      }
      if (roles.includes('kontrolle') || roles.includes('verwaltung')) {
        options.push(
          () => tree && draft('verschieben', who, { geometrie: point(rng) }, tree),
          () =>
            draft(
              'erfassen',
              who,
              bad ? {} : { geometrie: point(rng), vitalitaet: rng.pick(['v1', 'v2', 'v3']) },
            ),
        );
      }
      if (roles.includes('verwaltung')) {
        options.push(
          () => tree && draft('zuweisen', who, { zustaendig: rng.pick(['anna', 'bernd', 'vera']) }, tree),
          () =>
            areas.length > 0
              ? draft('flaeche_bearbeiten', who, { geometrie: square(rng) }, rng.pick(areas))
              : undefined,
          () => draft('baumart_anlegen', who, { name_de: text(rng, 'Art') }),
        );
      }
      if (roles.includes('kontrolle')) {
        options.push(() => tree && draft('massnahme_anlegen', who, { art: 'schnitt' }, tree));
      }
      if (roles.includes('bauhof') && measures.length > 0) {
        options.push(() => draft('massnahme_erledigen', who, {}, rng.pick(measures)));
      }
      return options.length > 0 ? rng.pick(options)() : undefined;
    },

    adminBatch(rng, view, who): readonly RunDraft[] {
      const trees = view.ids('baum').slice(0, 1 + rng.int(6));
      const to = rng.pick(['anna', 'bernd', 'vera']);
      // A batch is atomic (H2): now and then one item is invalid, which must refuse all of them.
      const spoil = rng.chance(0.3) ? rng.int(trees.length) : -1;
      return trees.map((t, i) => draft('zuweisen', who, i === spoil ? {} : { zustaendig: to }, t));
    },
  };
}
