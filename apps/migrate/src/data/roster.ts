/**
 * The participant roster of a migrated project (WP-168). The v3 users become `participants` rows: the v3 user id
 * (the id the converted runs name as their actor) and the roles, mapped through `Mapping.roles`. Ids and roles only:
 * v3 names and contact data are not carried over. Not a run (R3): a roster is identity, not a feature, and
 * `importParticipant` writes it the way an admin would (docs/04 and `packages/server/src/http/participants`).
 *
 * QR logins are not migrated; an admin issues them afterwards (`npm run admin -- participant qr`).
 */
import type { Db } from '@ueberblick/server';
import { importParticipant, updateParticipant } from '@ueberblick/server';
import type { Mapping } from '../config/convert';
import type { DataProblem, V3UserRecord } from './types';

export interface RosterResult {
  /** Users written to the roster (new rows; a user already in it only gets the roles replaced). */
  readonly filled: number;
  readonly problems: readonly DataProblem[];
}

/** Writes the users into the project database's roster. Safe to run again: it replaces the roles of a known id. */
export function fillRoster(
  db: Db,
  users: readonly V3UserRecord[],
  mapping: Pick<Mapping, 'roles'>,
  now: () => Date = () => new Date(),
): RosterResult {
  const problems: DataProblem[] = [];
  let filled = 0;
  const ctx = { db, now };
  for (const u of users) {
    const roles: string[] = [];
    for (const v3 of u.roles) {
      const v4 = mapping.roles[v3];
      if (v4 === undefined)
        problems.push({
          code: 'unknown_role',
          record: u.id,
          message: `role "${v3}" is not in the converted project; left out of the roster`,
        });
      else roles.push(v4);
    }
    const added = importParticipant(ctx, { id: u.id, roles });
    if (added.ok) filled++;
    else if (added.code === 'participant_exists') updateParticipant(ctx, u.id, { roles });
    else problems.push({ code: 'refused', record: u.id, message: `roster: ${added.code}` });
  }
  return { filled, problems };
}
