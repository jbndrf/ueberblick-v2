/** Test data for the e2e suites: what an installer's tooling will later create in control.db. */
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TemplateFile } from '@ueberblick/core';
import {
  importParticipant,
  createAuth,
  openControlDb,
  openProjectDb,
  publishTemplate,
  totpAt,
  base32Decode,
} from '@ueberblick/server';
import { parse } from 'yaml';
import { embedRefs } from '../../../scripts/embed-refs.mjs';

export interface Seeded {
  readonly email: string;
  readonly password: string;
  readonly totp: () => string;
  readonly participantToken: string;
  /** A second one-time token for the same participant. */
  readonly spareToken: string;
  readonly projectKeys: readonly string[];
}

/** What `seedControl` does besides the projects, the admin and the roster. */
export interface SeedOptions {
  /** Enrol and confirm TOTP for the admin (default). The demo and dev seeds turn it off (owner decision 6: TOTP is optional). */
  readonly totp?: boolean;
}

/**
 * Creates projects, one admin (member of all of them) and one QR credential for the first project, whose participant is on the roster.
 * With `{ totp: false }` the admin has no TOTP and `totp()` throws.
 */
export async function seedControl(
  dir: string,
  projectKeys: readonly string[],
  options: SeedOptions = {},
): Promise<Seeded> {
  mkdirSync(dir, { recursive: true });
  const control = openControlDb(`${dir}/control.db`);
  const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
  const now = new Date().toISOString();
  for (const key of projectKeys) {
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(`id-${key}`, key, key, now);
  }
  const email = 'admin@example.org';
  const password = 'correct horse battery';
  const accountId = await auth.createAdmin(email, password);
  for (const key of projectKeys) {
    control
      .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
      .run(accountId, `id-${key}`, 'verwaltung');
  }
  // TOTP counts as enrolled after the first successful code; each step is single-use, so logins use the next step.
  const STEP_MS = 30_000;
  let secret: string | null = null;
  if (options.totp !== false) {
    secret = auth.enrolTotp(accountId).secret;
    if (!auth.verifyTotp(accountId, totpAt(base32Decode(secret), Date.now())))
      throw new Error('TOTP enrolment failed');
  }
  const first = projectKeys[0];
  if (first === undefined) throw new Error('seedControl needs at least one project');
  // A-025: an id without a roster row is refused, so the participant joins the roster (the WP-168 function).
  const project = openProjectDb(dir, first);
  const added = importParticipant(
    { db: project, now: () => new Date() },
    { id: 'participant-1', name: 'Anna', roles: ['kontrolle'] },
  );
  project.close();
  if (!added.ok) throw new Error(`roster: ${added.code}`);
  const { token } = auth.issueCredential(`id-${first}`, 'participant-1');
  const spare = auth.issueCredential(`id-${first}`, 'participant-1').token;
  const tpl = embedRefs(
    parse(
      readFileSync(
        fileURLToPath(new URL('../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url)),
        'utf8',
      ),
    ),
    fileURLToPath(new URL('../../../', import.meta.url)),
  ) as TemplateFile;
  const published = publishTemplate(control, tpl, { now: () => now });
  if (!published.ok) throw new Error('golden template did not publish');
  control.close();
  return {
    email,
    password,
    totp: () => {
      if (secret === null) throw new Error('seedControl: this admin has no TOTP (seeded with totp: false)');
      return totpAt(base32Decode(secret), Date.now() + STEP_MS);
    },
    participantToken: token,
    spareToken: spare,
    projectKeys,
  };
}

/**
 * A reusable QR token for a participant of a project, who is first put on the roster (A-025: an id without a
 * roster row is refused). The one helper the e2e specs use instead of hand-rolled roster SQL.
 */
export function rosterToken(
  dir: string,
  projectKey: string,
  participantId: string,
  roles: readonly string[] = [],
): string {
  const control = openControlDb(`${dir}/control.db`);
  try {
    const row = control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(projectKey);
    if (!row) throw new Error(`rosterToken: unknown project ${projectKey}`);
    const project = openProjectDb(dir, projectKey);
    try {
      const added = importParticipant({ db: project, now: () => new Date() }, { id: participantId, roles });
      if (!added.ok && added.code !== 'participant_exists') throw new Error(`roster: ${added.code}`);
    } finally {
      project.close();
    }
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    return auth.issueCredential(row.id, participantId).token;
  } finally {
    control.close();
  }
}

/** Revokes every QR token of a participant of a project (what `participant revoke` does). */
export function revokeTokens(dir: string, projectKey: string, participantId: string): void {
  const control = openControlDb(`${dir}/control.db`);
  try {
    const row = control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(projectKey);
    if (!row) throw new Error(`revokeTokens: unknown project ${projectKey}`);
    createAuth({ control, now: () => new Date(), participantRoles: () => [] }).revokeParticipant(
      row.id,
      participantId,
    );
  } finally {
    control.close();
  }
}
