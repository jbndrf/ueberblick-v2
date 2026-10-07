import { defineRegistry, type KeyOf } from './define';
import type { LifecycleState } from './lifecycle';

/**
 * What a deploy does with the running features of a changed type (A-029 item 5, v3's "Laufende Fälle auf alter Version
 * belassen"): `keep` pins them to the version they run on (one `$pin` system run each), `move` lets them float onto the
 * new version, with the value moves of the deploy's mappings (WP-307). Settled features (completed, archived) always move.
 */
export const VERSION_DEPLOY_CHOICES = defineRegistry([
  {
    key: 'keep',
    label: {
      en: 'Keep running objects on the old version',
      de: 'Laufende Objekte auf alter Version belassen',
    },
    description:
      "Pins the type's running features to the version deployed now; they keep its tasks, forms and stages.",
  },
  {
    key: 'move',
    label: {
      en: 'Move running objects to the new version',
      de: 'Laufende Objekte auf neue Version verschieben',
    },
    description: "The running features float on the new version; the deploy's value moves apply to them.",
  },
] as const);
export type VersionDeployChoice = KeyOf<typeof VERSION_DEPLOY_CHOICES>;

/** The choice of a type the deploy request does not name (owner question P2 (a): fewer live versions). One switch. */
export const VERSION_DEPLOY_DEFAULT: VersionDeployChoice = 'move';

/** The lifecycle state of a "running" feature (WP-305): the ones a `keep` pins. Completed and archived ones are settled. */
export const RUNNING_LIFECYCLE = 'active' satisfies LifecycleState;

/** Why publishing a template version is refused (docs/05 "Minor versions"): `checkPublish` raises these. */
export const PUBLISH_REFUSALS = defineRegistry([
  { key: 'key_changed', description: 'The key differs from the previous version of the template.' },
  { key: 'version_not_higher', description: 'The version is not higher than the previous one.' },
  { key: 'breaking_in_minor', description: 'The version stays in its major but removes or changes keys.' },
] as const);
export type PublishRefusal = KeyOf<typeof PUBLISH_REFUSALS>;
