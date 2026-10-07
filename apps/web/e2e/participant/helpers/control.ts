import { openControlDb, openProjectDb } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../../playwright.config';

/** Direct access to the e2e server's stores, to age or switch off what the real app would age over weeks (WP-831). */
function withControl<T>(fn: (db: ReturnType<typeof openControlDb>) => T): T {
  const db = openControlDb(`${E2E_DATA_DIR}/control.db`);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** The sessions of a participant (subject ends with the participant id): expiry instants, ISO strings. */
export function sessionExpiries(participant: string): string[] {
  return withControl((db) =>
    db
      .prepare<{ expires_at: string }>("SELECT expires_at FROM sessions WHERE subject LIKE '%' || ?")
      .all(participant)
      .map((r) => r.expires_at),
  );
}

/** Sets the expiry of every session of a participant. */
export function setSessionExpiry(participant: string, at: Date): void {
  withControl((db) =>
    db
      .prepare("UPDATE sessions SET expires_at = ? WHERE subject LIKE '%' || ?")
      .run(at.toISOString(), participant),
  );
}

/** Sets the expiry of the credentials of a participant (the printed QR's own end date). */
export function setCredentialExpiry(participant: string, at: Date): void {
  withControl((db) =>
    db
      .prepare('UPDATE credentials SET expires_at = ? WHERE participant_id = ?')
      .run(at.toISOString(), participant),
  );
}

/** Switches a participant off (what the admin's "deaktivieren" writes). */
export function disableParticipant(key: string, participant: string): void {
  const db = openProjectDb(E2E_DATA_DIR, key);
  try {
    db.prepare('UPDATE participants SET disabled_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      participant,
    );
  } finally {
    db.close();
  }
}

/** Replaces the roles of a participant. */
export function setParticipantRoles(key: string, participant: string, roles: string[]): void {
  const db = openProjectDb(E2E_DATA_DIR, key);
  try {
    db.prepare('UPDATE participants SET roles = ? WHERE id = ?').run(JSON.stringify(roles), participant);
  } finally {
    db.close();
  }
}
