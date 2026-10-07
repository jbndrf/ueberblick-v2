import type { FeatureId, Key } from '@ueberblick/core/model';
import type { FilterController } from '../sheets/filter/filter-controller';
import { typeSwitchOn } from '../sheets/filter/filter-state';

export interface AfterCreate {
  readonly id: FeatureId;
  /** The Objektart the task created; undefined when the config does not say. */
  readonly type: Key | undefined;
  readonly filter: Pick<FilterController, 'state' | 'revealType'>;
  readonly openFeature: (id: FeatureId) => void;
  /** Clears a pending parent link (v3 `pendingChildLink = null`, :2321); WP-677 hands in its chain state here. */
  readonly clearLink?: () => void;
}

/**
 * What v3 did when a create succeeded (`+page.svelte:2321-2359`): drop the pending parent link, make the new type
 * visible if the participant had switched it off ("Ensure the new workflow type is visible"), and open the new
 * feature's detail. Only the type flag is touched (`revealType`): the hidden stages, other switches and an active view
 * stay, and if one of them still hides the feature the detail opens anyway.
 */
export function afterCreate(a: AfterCreate): void {
  a.clearLink?.();
  if (a.type !== undefined && !typeSwitchOn(a.filter.state(), a.type)) a.filter.revealType(a.type);
  a.openFeature(a.id);
}
