import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Why a self-join link change or a join was refused (R6). */
export const JOIN_ERRORS = defineRegistry([
  {
    key: 'slug_invalid',
    description: 'The slug is not 3-64 characters of a-z, 0-9 and "-" (starting with a letter or digit).',
  },
  { key: 'slug_taken', description: 'Another role in this instance already uses the slug.' },
  { key: 'role_invalid', description: 'The role is not a valid key.' },
  { key: 'link_unknown', description: 'No enabled self-join link has this slug (v3: "Not found").' },
  { key: 'join_failed', description: 'The guest could not be created or signed in.' },
] as const);
export type JoinErrorCode = KeyOf<typeof JOIN_ERRORS>;
