/**
 * What the open app derives from the person's role, kept current when the roles change in place (WP-796; v3 followed
 * its live `roles` collection, `reference/src/routes/(participant)/map/+page.svelte:405`): the tool person, the layer
 * controller, the tool switches and the cluster preferences. A new role gets new controllers over the same record; the
 * filter, the open sheets and the drafts are not touched. Called once, while the screen initialises.
 */
import { untrack } from 'svelte';
import type { PrefsClient } from '@ueberblick/client';
import type { Device } from '../device';
import { bindViews } from '../sheets/filter/filter-active';
import type { FilterController } from '../sheets/filter/filter-controller';
import {
  createLayerController,
  participantMap,
  type LayerController,
} from '../sheets/layer/layer-controller';
import { prefsLayerChoice } from '../sheets/layer/layer-prefs';
import { CLUSTER_TOOL, clusterPrefs } from '../tools/cluster';
import type { ToolSwitchMap } from '../tools/entries';
import { createToolPerson, type ToolPerson } from '../tools/person';

export interface RoleControllers {
  readonly person: ToolPerson;
  readonly layers: LayerController;
  readonly switches: ToolSwitchMap;
  readonly clusterState: ReturnType<typeof clusterPrefs>;
}

export function roleControllers(
  device: Device,
  prefs: PrefsClient,
  filter: FilterController,
): RoleControllers {
  const makeLayers = () =>
    createLayerController({
      map: participantMap(device.config.file.map, device.actor.roles),
      store: prefsLayerChoice(prefs),
    });
  const makePerson = () =>
    createToolPerson({
      file: device.config.file,
      roleKey: device.roleKey ?? '',
      prefs,
      flush: () => void prefs.sync(),
    });
  let layers = $state.raw(untrack(makeLayers));
  let person = $state.raw(untrack(makePerson));
  let switches = $state(person.switches());
  // The Cluster tool's own preferences (WP-666): the map un-clusters from them whether or not the sheet is open.
  let clusterState = $state(clusterPrefs(person.preferencesOf(CLUSTER_TOOL)));

  const scope = $derived(`${device.roleKey ?? ''}|${[...device.actor.roles].sort().join(',')}`);
  let builtFor = untrack(() => scope);
  $effect(() => {
    if (scope === builtFor) return;
    builtFor = scope;
    untrack(() => {
      person = makePerson();
      layers = makeLayers();
      switches = person.switches();
      clusterState = clusterPrefs(person.preferencesOf(CLUSTER_TOOL));
    });
  });
  // The person's tool settings, the active view and the layer choice follow the current controllers.
  $effect(() => {
    const [now, shown, roleKey] = [person, layers, device.roleKey ?? ''];
    const off = [
      now.subscribe(() => {
        switches = now.switches();
        clusterState = clusterPrefs(now.preferencesOf(CLUSTER_TOOL));
      }),
      // The active view comes back with the person, and the map re-evaluates it when its source or the tool's switch changes (WP-665).
      bindViews({ filter, record: prefs, file: device.config.file, roleKey }),
      shown.subscribe(() => void prefs.sync()), // a change of the choice goes to the server at once
    ];
    return () => off.forEach((stop) => stop());
  });
  return {
    get person() {
      return person;
    },
    get layers() {
      return layers;
    },
    get switches() {
      return switches;
    },
    get clusterState() {
      return clusterState;
    },
  };
}
