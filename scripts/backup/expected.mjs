// What the server knows: its migrations and its read-only migration check, imported from the server package
// (TypeScript, loaded by scripts/backup/register.mjs under plain node, or by vitest in tests).
import { migrationState } from '../../packages/server/src/db/migrate.ts';
import { CONTROL_MIGRATIONS } from '../../packages/server/src/db/control-schema.ts';
import { PROJECT_MIGRATIONS } from '../../packages/server/src/db/project-schema.ts';

export function expectedMigrations() {
  return { control: CONTROL_MIGRATIONS, project: PROJECT_MIGRATIONS, migrationState };
}
