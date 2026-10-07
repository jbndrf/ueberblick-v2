/**
 * The command interpreter behind `npm run admin -- <command>`. Pure of process globals: arguments, environment
 * and output arrive as parameters so it can be tested. Secrets are never echoed; the only secrets ever printed
 * are the one-time TOTP enrolment URI of `create-admin` and the QR token of `participant qr`.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localize } from '@ueberblick/core';
import { parse } from 'yaml';
import { createAuth } from '../auth';
import { MIN_PASSWORD_LENGTH } from '../auth/params';
import { openControlDb } from '../db/open';
import { PARTICIPANT_USAGE, runParticipant } from './cli-participants';
import {
  addMembership,
  confirmAdminTotp,
  createAdmin,
  createProject,
  publishTemplateFile,
} from './bootstrap';

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

export const USAGE = `Usage: npm run admin -- <command>
  create-project <key> <name>
  create-admin <email>              password from UEBERBLICK_ADMIN_PASSWORD (never as an argument)
  confirm-totp <email> <code>       first valid code from the authenticator app
  add-membership <email> <project> <role>
  publish-template <file.yaml>
${PARTICIPANT_USAGE}
Data directory: DATA_DIR (default ./data).`;

/** Runs one command; returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
): Promise<number> {
  const [cmd, ...args] = argv;
  const need = (n: number): boolean => {
    if (args.length === n) return true;
    io.err(USAGE);
    return false;
  };
  if (
    cmd === undefined ||
    ![
      'create-project',
      'create-admin',
      'confirm-totp',
      'add-membership',
      'publish-template',
      'participant',
    ].includes(cmd)
  ) {
    io.err(USAGE);
    return 2;
  }
  const dataDir = env['DATA_DIR'] ?? './data';
  mkdirSync(dataDir, { recursive: true });
  const control = openControlDb(join(dataDir, 'control.db'));
  const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
  const clock = { now: () => new Date().toISOString() };
  try {
    switch (cmd) {
      case 'create-project': {
        if (!need(2)) return 2;
        const p = createProject(control, { key: args[0] ?? '', name: args[1] ?? '' }, clock);
        io.out(`Project ${p.key} created.`);
        return 0;
      }
      case 'create-admin': {
        if (!need(1)) return 2;
        const password = env['UEBERBLICK_ADMIN_PASSWORD'];
        if (!password) {
          io.err(`Set UEBERBLICK_ADMIN_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters).`);
          return 2;
        }
        const r = await createAdmin(auth, args[0] ?? '', password);
        io.out(`Admin ${args[0]} created. Add this to an authenticator app now; it is shown only once:`);
        io.out(r.otpauthUri);
        io.out('Then confirm it: npm run admin -- confirm-totp <email> <code>');
        return 0;
      }
      case 'confirm-totp': {
        if (!need(2)) return 2;
        if (!confirmAdminTotp(control, auth, args[0] ?? '', args[1] ?? '')) {
          io.err('The code was not accepted.');
          return 1;
        }
        io.out('TOTP confirmed. The admin can log in.');
        return 0;
      }
      case 'add-membership': {
        if (!need(3)) return 2;
        addMembership(control, { email: args[0] ?? '', projectKey: args[1] ?? '', role: args[2] ?? '' });
        io.out(`${args[0]} is now ${args[2]} in ${args[1]}.`);
        return 0;
      }
      case 'participant':
        return runParticipant(args, { dataDir, control, auth, now: () => new Date() }, io);
      default: {
        if (!need(1)) return 2;
        const r = publishTemplateFile(control, parse(readFileSync(args[0] ?? '', 'utf8')), clock);
        if (!r.ok) {
          io.err(
            'The template was refused: ' +
              ('error' in r
                ? r.error
                : r.problems.map((p) => `${p.path}: ${localize(p.message, ['de', 'en'])}`).join('; ')),
          );
          return 1;
        }
        io.out(r.created ? 'Template published.' : 'Template already published (unchanged).');
        return 0;
      }
    }
  } catch (e) {
    io.err(e instanceof Error ? e.message : 'Failed.');
    return 1;
  } finally {
    control.close();
  }
}
