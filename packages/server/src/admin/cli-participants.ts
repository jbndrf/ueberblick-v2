/**
 * `participant add|roles|list|disable|enable|remove|qr|revoke` of `npm run admin` (WP-168): the roster and QR logins of one project.
 * The QR token is the only secret printed, once, like the TOTP URI of `create-admin`.
 */
import type { Auth } from '../auth';
import type { Db } from '../db/driver';
import { openProjectDb } from '../db/open';
import {
  addParticipant,
  disableParticipant,
  enableParticipant,
  issueQr,
  listParticipants,
  listQrs,
  removeParticipant,
  revokeQrs,
  updateParticipant,
  type Done,
} from '../http/participants';
import type { CliIo } from './cli-run';

export const PARTICIPANT_USAGE = `  participant add <project> <name> [roles]        name: required; the id is generated; roles: comma-separated keys
  participant roles <project> <id> <roles>        replace the roles
  participant list <project>                      the roster and its active QR logins
  participant disable <project> <id>              switch off: sessions and QR logins are refused until enable
  participant enable <project> <id>               switch on again
  participant remove <project> <id>               disable and hide, revoke QR logins, end sessions
  participant qr <project> <id> [expiresAt]       issue a reusable QR token (shown once; no expiry unless [expiresAt] is given)
  participant revoke <project> <id>               revoke all QR logins and end sessions`;

const roleList = (s: string | undefined): string[] =>
  (s ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r !== '');

export function runParticipant(
  args: readonly string[],
  env: { readonly dataDir: string; readonly control: Db; readonly auth: Auth; readonly now: () => Date },
  io: CliIo,
): number {
  const [verb, projectKey, id, a] = args;
  const project =
    projectKey === undefined
      ? undefined
      : env.control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(projectKey);
  if (verb === undefined || projectKey === undefined || (verb !== 'list' && id === undefined)) {
    io.err(PARTICIPANT_USAGE);
    return 2;
  }
  if (!project) {
    io.err(`unknown project: ${projectKey}`);
    return 1;
  }
  const db = openProjectDb(env.dataDir, projectKey);
  try {
    const ctx = { control: env.control, db, auth: env.auth, projectId: project.id, now: env.now };
    const report = (r: Done, message: string): number => {
      if (r.ok) io.out(message);
      else io.err(`Refused: ${r.code}`);
      return r.ok ? 0 : 1;
    };
    const who = id ?? '';
    switch (verb) {
      case 'add': {
        const r = addParticipant(ctx, { name: who, roles: roleList(a) });
        return report(r, r.ok ? `${who} added to ${projectKey} with id ${r.id}.` : '');
      }
      case 'disable':
        return report(disableParticipant(ctx, who), `${who} disabled.`);
      case 'enable':
        return report(enableParticipant(ctx, who), `${who} enabled.`);
      case 'roles':
        return report(updateParticipant(ctx, who, { roles: roleList(a) }), `Roles of ${who} replaced.`);
      case 'remove':
        return report(removeParticipant(ctx, who), `${who} removed; QR logins revoked, sessions ended.`);
      case 'revoke':
        return report(revokeQrs(ctx, who), `QR logins of ${who} revoked, sessions ended.`);
      case 'list': {
        const active = listQrs(ctx);
        for (const p of listParticipants(ctx)) {
          const n = active.filter((q) => q.participantId === p.id).length;
          io.out(`${p.id}\t${p.roles.join(',')}\t${p.disabledAt === null ? 'active' : 'disabled'}\t${n} QR`);
        }
        return 0;
      }
      case 'qr': {
        const r = issueQr(ctx, who, a);
        if (!r.ok) return report(r, '');
        io.out(`QR token for ${who} (shown once, valid until ${r.expiresAt}):`);
        io.out(r.token);
        return 0;
      }
      default:
        io.err(PARTICIPANT_USAGE);
        return 2;
    }
  } finally {
    db.close();
  }
}
