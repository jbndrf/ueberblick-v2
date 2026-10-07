import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqlite } from './driver';
import { migrate, migrationState, type Migration } from './migrate';
import { PROJECT_MIGRATIONS } from './project-schema';

const run = promisify(execFile);
const STEPS: Migration[] = [
  { id: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' },
  { id: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER)' },
];
let dir: string;
// a fresh directory per test: fixed file names must not see a file migrated by an earlier repeat
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-race-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migrate across connections (WP-1032)', () => {
  it('a connection that saw a step as pending applies nothing once another applied it', () => {
    const file = join(dir, 'two.db');
    const a = openSqlite(file);
    const b = openSqlite(file);
    migrate(b, []); // creates schema_migrations
    expect(migrationState(b, STEPS).pending).toEqual([1, 2]);
    expect(migrate(a, STEPS)).toEqual([1, 2]);
    expect(() => migrate(b, STEPS)).not.toThrow();
    expect(migrate(b, STEPS)).toEqual([]);
    const tables = b
      .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('a','b')")
      .all();
    expect(tables).toHaveLength(2);
    expect(b.prepare<{ n: number }>('SELECT count(*) AS n FROM schema_migrations').get()?.n).toBe(2);
    a.close();
    b.close();
  });

  it('a second run is a no-op', () => {
    const db = openSqlite(join(dir, 'again.db'));
    expect(migrate(db, STEPS)).toEqual([1, 2]);
    expect(migrate(db, STEPS)).toEqual([]);
    db.close();
  });

  it('two processes migrating one fresh file at the same moment both exit 0', async () => {
    const script = join(dir, 'child.cjs');
    const entry = join(dir, 'child.ts');
    const src = fileURLToPath(new URL('.', import.meta.url));
    writeFileSync(
      entry,
      `import { openSqlite } from ${JSON.stringify(join(src, 'driver'))};
import { migrate } from ${JSON.stringify(join(src, 'migrate'))};
import { PROJECT_MIGRATIONS } from ${JSON.stringify(join(src, 'project-schema'))};
const db = openSqlite(process.argv[2]);
const t = Number(process.argv[3]);
while (Date.now() < t) { /* spin to a shared start */ }
migrate(db, PROJECT_MIGRATIONS);
db.close();
`,
    );
    buildSync({
      entryPoints: [entry],
      outfile: script,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['better-sqlite3'],
      logLevel: 'silent',
    });
    const env = { ...process.env, NODE_PATH: join(src, '../../../../node_modules') };
    for (let i = 0; i < 20; i++) {
      const file = join(dir, `race-${i}.db`);
      const at = String(Date.now() + 120);
      const results = await Promise.allSettled([
        run(process.execPath, [script, file, at], { env }),
        run(process.execPath, [script, file, at], { env }),
      ]);
      for (const r of results)
        expect(r.status, r.status === 'rejected' ? String(r.reason) : '').toBe('fulfilled');
      const db = openSqlite(file);
      expect(migrationState(db, PROJECT_MIGRATIONS).pending).toEqual([]);
      db.close();
    }
  }, 30_000);
});
