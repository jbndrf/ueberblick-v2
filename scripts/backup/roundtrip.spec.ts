// WP-493 (verify step 1): s1.backup and s1.restore-command. Data in a temp data dir, the real backup path (Litestream
// to a file replica + the files copy + the journal export), the data dir wiped, the documented restore, data back.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTOR_KINDS, RUN_OUTCOMES } from '@ueberblick/core';
import { openControlDb, openProjectDb } from '../../packages/server/src/db/open';
import { generateConfig } from './config.mjs';
import { folderLayout } from './layout.mjs';
import { LITESTREAM_VERSION } from './litestream.mjs';
import { restoreFromFolder } from './restore.mjs';
import { backupRound } from './run.mjs';
import { specEnv } from '../testing/spec-env.mjs';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-roundtrip-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const binDir = join(homedir(), '.cache', 'ueberblick', `litestream-${LITESTREAM_VERSION}`);
const hasLitestream = existsSync(join(binDir, 'litestream'));

describe('backup and restore, end to end (real Litestream, file replica)', () => {
  it.skipIf(!hasLitestream)(
    'data and a file survive: back up, wipe the data folder, restore with the documented command path',
    async () => {
      const data = tmp();
      const backup = tmp();
      const layout = folderLayout(backup);
      const control = openControlDb(join(data, 'control.db'));
      control
        .prepare("INSERT INTO projects (id, key, name, created_at) VALUES ('p1', 'baum', 'Baum', 'now')")
        .run();
      const project = openProjectDb(data, 'baum');
      project
        .prepare(
          "INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome) VALUES ('run-1', 'a', ?, 't', 1, '{}', 'now', ?)",
        )
        .run(ACTOR_KINDS.keys[0], RUN_OUTCOMES.keys[0]);
      project
        .prepare('INSERT INTO observations (run_id, feature_id, property, result) VALUES (?, ?, ?, ?)')
        .run('run-1', 'feature-1', 'name', '"Eiche"');
      const blob = join(data, 'blobs', 'baum', 'ab', 'abc.bin');
      mkdirSync(join(blob, '..'), { recursive: true });
      writeFileSync(blob, 'photo bytes');

      // the backup path: Litestream replicates every database, the service mirrors files and exports the journal
      const cfg = join(tmp(), 'litestream.yml');
      writeFileSync(
        cfg,
        generateConfig({ dataDir: data, replicaBase: layout.replicaBase, syncInterval: '100ms' }),
      );
      const child = spawn(join(binDir, 'litestream'), ['replicate', '-config', cfg], {
        stdio: 'ignore',
        env: specEnv(),
      });
      const exited = new Promise<void>((r) => child.once('exit', () => r()));
      const synced = (): boolean =>
        ['control.db', 'project-baum.db'].every((d) => existsSync(join(layout.replicaDir, d, 'generations')));
      const deadline = Date.now() + 60_000;
      while (!synced() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      expect(synced()).toBe(true);
      await new Promise((r) => setTimeout(r, 1500)); // let the WAL segments land
      const round = backupRound({ dataDir: data, backupDir: backup });
      child.kill('SIGINT');
      await exited;
      expect(round.problems).toEqual([]);
      expect(round.files.copied).toBe(1);
      control.close();
      project.close();

      // disaster: the data folder is gone
      rmSync(data, { recursive: true, force: true });
      expect(existsSync(data)).toBe(false);

      // the documented restore (docs/user/admin/backup.md: `... run --rm backup restore`) runs restoreFromFolder
      const r = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        pathEnv: `${binDir}:${process.env.PATH ?? ''}`,
      });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      expect(readFileSync(join(data, 'blobs', 'baum', 'ab', 'abc.bin'), 'utf8')).toBe('photo bytes');
      const back = openProjectDb(data, 'baum');
      expect(back.prepare('SELECT result FROM observations WHERE run_id = ?').get('run-1')).toEqual({
        result: '"Eiche"',
      });
      back.close();
      const ctl = openControlDb(join(data, 'control.db'));
      expect(ctl.prepare("SELECT name FROM projects WHERE key = 'baum'").get()).toEqual({ name: 'Baum' });
      ctl.close();
    },
    120_000,
  );
});

describe('the deploy files wire the backup and the restore command (static, no docker build)', () => {
  const compose = read('docker-compose.yaml');
  const backupService = compose.slice(compose.indexOf('\n  backup:'));

  it('the backup service is a compose profile that mounts data and BACKUP_DIR and refuses an empty BACKUP_DIR', () => {
    expect(backupService).toContain("profiles: ['backup']");
    expect(backupService).toContain('./data:/data');
    expect(backupService).toContain('${BACKUP_DIR:-./backup-not-configured}:/backup');
    expect(backupService).toContain('BACKUP_DIR_SET: ${BACKUP_DIR:-}');
    expect(read('scripts/backup/run.mjs')).toMatch(/BACKUP_DIR_SET === ''[\s\S]*process\.exit\(1\)/);
  });

  it('the image pins Litestream and its command script has run and restore [--force]', () => {
    const image = read('ops/litestream/Dockerfile');
    expect(image).toContain(`LITESTREAM_VERSION=${LITESTREAM_VERSION}`);
    expect(image).toContain(
      'ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "/app/scripts/backup/backup-cmd.sh"]',
    );
    const cmd = read('scripts/backup/backup-cmd.sh');
    expect(cmd).toContain('run) exec node scripts/backup/run.mjs');
    expect(cmd).toContain('scripts/backup/restore.mjs "${BACKUP_TARGET:-/backup}" "${DATA_DIR:-/data}" "$@"');
  });

  it('the generated Litestream config replicates control.db and every project database to the backup folder', () => {
    const data = tmp();
    openControlDb(join(data, 'control.db')).close();
    openProjectDb(data, 'baum').close();
    const yml = generateConfig({ dataDir: data, replicaBase: folderLayout('/backup').replicaBase });
    expect(yml).toContain(`${data}/control.db`);
    expect(yml).toContain(`${data}/project-baum.db`);
    expect(yml).toContain('file:///backup/databases/');
  });

  it('the documented restore command is the one the compose service and the script implement (de and en)', () => {
    for (const f of ['docs/user/admin/backup.md', 'docs/user/admin/backup.en.md'])
      expect(read(f)).toContain('docker compose --profile backup run --rm backup restore');
  });

  it('the shell scripts parse', () => {
    for (const f of ['backup-cmd.sh', 'entrypoint.sh'])
      execFileSync('sh', ['-n', join(root, 'scripts/backup', f)], { env: specEnv() });
  });
});
