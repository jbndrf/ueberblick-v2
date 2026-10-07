/**
 * WP-755: what a bound actor's expressions can read. A feature the actor may not see reads as absent (no
 * property, no relations, no type), so `self.ziel.titel` cannot copy a hidden value. Applied to the task's own
 * expressions (availability, form, `then`); computed properties and rules stay actor-independent.
 */
import type { FeatureAccess } from '../expr/contract';
import type { FeatureId } from '../model';

export interface Guard {
  /** May the actor read this feature at all (exists and `see`)? */
  readonly visible: (id: FeatureId) => boolean;
  /** Does a relation list yield this feature? Visible and live (WP-765); `of` and bind read with `members` off. */
  readonly member: (id: FeatureId) => boolean;
}

/**
 * Reading through a hidden feature yields nothing. A relation list yields only members (visible, live), so
 * `size(self.kinder)` cannot count hidden features (WP-765). `of` and bind targets read with `members` off: they
 * are explicit pointers, and one at a hidden id is refused loudly by `liveAndVisible` (WP-755), not skipped.
 */
export function visibleOnly(base: FeatureAccess, guard: Guard, members = true): FeatureAccess {
  const { visible, member } = guard;
  return {
    property: (id, key) => (visible(id) ? base.property(id, key) : undefined),
    related: (id, relation) =>
      visible(id) ? (members ? base.related(id, relation).filter(member) : base.related(id, relation)) : [],
    history: (id, property, limit) => (visible(id) ? base.history(id, property, limit) : []),
    type: (id) => (visible(id) ? base.type(id) : undefined),
  };
}
