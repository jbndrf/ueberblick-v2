// Reproducible docker round trip of the folder backup (WP-943). Not part of `npm run check` (needs docker, builds the image).
//   node scripts/backup/docker-roundtrip.mjs
// It re-executes itself with the Node flags it needs, sets PUBLIC_URL for compose itself (no .env needed), and
// backs up into BACKUP_DIR (optional, an absolute folder; default: <tmp>/ub-backup-roundtrip). The data dir is a
// fresh temporary folder (mounted through a compose override), never ./data; `compose down` always runs at the end.
// Steps: seed data/ (control.db, project-baum.db, one blob) -> start the backup service -> wait for a database replica
// and the journal -> stop -> wipe data/ -> `restore` from the image -> check databases and blob are back.
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const FLAGS = [
  '--disable-warning=ExperimentalWarning',
  '--experimental-transform-types',
  '--import',
  './scripts/backup/register.mjs',
];
if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(process.execPath, [...FLAGS, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const { openControlDb, openProjectDb } = await import('../../packages/server/src/db/open.ts');

const backupDir = resolve(process.env.BACKUP_DIR ?? join(tmpdir(), 'ub-backup-roundtrip'));
const data = join(mkdtempSync(join(tmpdir(), 'ub-roundtrip-')), 'data');
const override = join(resolve(data, '..'), 'compose.override.yaml');
writeFileSync(override, `services:\n  backup:\n    volumes:\n      - ${data}:/data\n`);
const env = { ...process.env, BACKUP_DIR: backupDir, PUBLIC_URL: 'http://localhost:3000' };
const compose = (...args) =>
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'ub-roundtrip',
      '-f',
      'docker-compose.yaml',
      '-f',
      override,
      '--profile',
      'backup',
      ...args,
    ],
    { env, stdio: 'inherit' },
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (ok, what) => {
  if (!ok) throw new Error(`ROUND TRIP FAILED: ${what}`);
};
const asContainerUser = (script) =>
  execFileSync(
    'docker',
    ['run', '--rm', '-v', `${resolve(data, '..')}:/work`, 'alpine', 'sh', '-c', script],
    {
      stdio: 'inherit',
    },
  );

let failed = false;
try {
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(join(data, 'blobs/baum/ab'), { recursive: true });
  openControlDb(join(data, 'control.db')).close();
  openProjectDb(data, 'baum').close();
  writeFileSync(join(data, 'blobs/baum/ab/blob.bin'), 'bytes');

  compose('up', '-d', '--build', 'backup');
  for (let i = 0; i < 60 && !existsSync(join(backupDir, 'journal/journal.json')); i++) await sleep(2000);
  must(existsSync(join(backupDir, 'journal/journal.json')), 'no journal after 2 minutes');
  await sleep(5000); // let Litestream write the first generation
  compose('stop', 'backup');

  // wipe through the container: files in data/ belong to the container user
  asContainerUser('rm -rf /work/data/* /work/data/.[!.]*');
  must(readdirSync(data).length === 0, 'data dir was not wiped');

  compose('run', '--rm', 'backup', 'restore');
  must(existsSync(join(data, 'control.db')), 'control.db not restored');
  must(existsSync(join(data, 'project-baum.db')), 'project-baum.db not restored');
  must(readFileSync(join(data, 'blobs/baum/ab/blob.bin'), 'utf8') === 'bytes', 'blob not restored');
  must(!existsSync(join(data, '.restore-staging')), 'staging folder left behind');
  console.log('ROUND TRIP PASSED (databases and blob restored from the image)');
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : e);
} finally {
  try {
    compose('down', '--remove-orphans');
  } catch (e) {
    console.error('compose down failed:', e instanceof Error ? e.message : e);
  }
  try {
    asContainerUser('rm -rf /work/data');
  } catch {
    // best effort: the folder is under the OS tmp dir
  }
  rmSync(resolve(data, '..'), { recursive: true, force: true });
  rmSync(join(backupDir, 'files'), { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
