import { defineRegistry, type KeyOf } from './define';

/** Who performs a run (docs/01-glossary.md "Actor"). */
export const ACTOR_KINDS = defineRegistry([
  { key: 'participant', description: 'A field user with a QR login.' },
  { key: 'admin', description: 'An account acting in the admin/builder.' },
  { key: 'system', description: 'A rule or template migration.' },
  { key: 'import', description: 'A bulk import (CSV, GeoJSON, GeoPackage).' },
] as const);

export type ActorKind = KeyOf<typeof ACTOR_KINDS>;
