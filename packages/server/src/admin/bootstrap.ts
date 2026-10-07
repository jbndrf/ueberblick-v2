/**
 * Operator bootstrap (WP-114): projects, admin accounts, memberships and published templates, as plain
 * functions. The CLI (`npm run admin`) calls them; they take the adapters as arguments and do no I/O of
 * their own besides control.db.
 */
import { randomUUID } from 'node:crypto';
import type { TemplateFile } from '@ueberblick/core';
import type { Auth } from '../auth';
import type { Db } from '../db/driver';
import { assertProjectKey } from '../db/open';
import { publishTemplate, type PublishResult } from '../templates';

interface Clock {
  now(): string;
}

/** Creates a project row. Throws for an invalid or duplicate key. */
export function createProject(
  control: Db,
  input: { readonly key: string; readonly name: string; readonly description?: string },
  clock: Clock,
): { readonly id: string; readonly key: string } {
  assertProjectKey(input.key);
  const id = randomUUID();
  control
    .prepare('INSERT INTO projects (id, key, name, description, created_at) VALUES (?,?,?,?,?)')
    .run(id, input.key, input.name, input.description ?? '', clock.now());
  return { id, key: input.key };
}

/**
 * Creates an admin account and starts TOTP enrolment. The `otpauthUri` (it contains the secret) is returned
 * once and stored nowhere else in readable form; the caller must show it to the operator and forget it.
 */
export async function createAdmin(
  auth: Auth,
  email: string,
  password: string,
): Promise<{ readonly accountId: string; readonly otpauthUri: string }> {
  const accountId = await auth.createAdmin(email, password);
  return { accountId, otpauthUri: auth.enrolTotp(accountId).otpauthUri };
}

function accountIdOf(control: Db, email: string): string {
  const row = control
    .prepare<{ id: string }>('SELECT id FROM accounts WHERE email = ?')
    .get(email.trim().toLowerCase());
  if (!row) throw new Error(`unknown account: ${email}`);
  return row.id;
}

/** Confirms the pending TOTP enrolment of an account with its first valid code. */
export function confirmAdminTotp(control: Db, auth: Auth, email: string, code: string): boolean {
  return auth.verifyTotp(accountIdOf(control, email), code);
}

/** Gives an admin account a role in a project. Throws for an unknown account or project. */
export function addMembership(
  control: Db,
  input: { readonly email: string; readonly projectKey: string; readonly role: string },
): void {
  const accountId = accountIdOf(control, input.email);
  const project = control
    .prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?')
    .get(input.projectKey);
  if (!project) throw new Error(`unknown project: ${input.projectKey}`);
  control
    .prepare(
      'INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?) ON CONFLICT (account_id, project_id) DO UPDATE SET role = excluded.role',
    )
    .run(accountId, project.id, input.role);
}

/** Publishes a template into control.db. Takes `unknown` so a raw parsed YAML file can be passed in. */
export function publishTemplateFile(control: Db, file: unknown, clock: Clock): PublishResult {
  return publishTemplate(control, file as TemplateFile, clock);
}
