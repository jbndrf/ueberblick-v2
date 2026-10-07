// The backup service (compose profile `backup`): keeps Litestream running for every database in the data directory,
// mirrors the blob files and exports the erasure journal, all into the local folder BACKUP_DIR.
// Litestream 0.3 cannot reload its config, so when the set of databases changes (a new project) the service rewrites the
// config and restarts Litestream. A restart costs a moment of catch-up, not data: Litestream resumes from the WAL.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateConfig } from './config.mjs';
import { syncTree } from './files.mjs';
import { exportJournal } from './journal.mjs';
import { DATA_BLOBS, folderLayout } from './layout.mjs';

/** Writes litestream.yml for the databases now in `dataDir`. Returns { changed, databases }; nothing before control.db exists. */
export function refreshConfig({ dataDir, backupDir, configPath }) {
  if (!existsSync(join(dataDir, 'control.db'))) return { changed: false, databases: [] };
  const text = generateConfig({ dataDir, replicaBase: folderLayout(backupDir).replicaBase });
  const databases = [...text.matchAll(/^ {2}- path: .*\/([^/]+\.db)$/gm)].map((m) => m[1]);
  const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  if (before === text) return { changed: false, databases };
  writeFileSync(configPath, text);
  return { changed: true, databases };
}

/** One round of the file mirror and journal export. Errors are returned, never thrown, so one failure never stops the loop. */
export function backupRound({ dataDir, backupDir }) {
  const layout = folderLayout(backupDir);
  const problems = [];
  let files = { copied: 0, removed: 0 };
  try {
    files = syncTree(join(dataDir, DATA_BLOBS), layout.filesDir);
  } catch (e) {
    problems.push(`files: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    if (existsSync(join(dataDir, 'control.db'))) {
      mkdirSync(layout.journalDir, { recursive: true });
      const tmp = layout.journalPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(exportJournal(dataDir), null, 2) + '\n');
      renameSync(tmp, layout.journalPath);
    }
  } catch (e) {
    problems.push(`journal: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { files, problems };
}

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...extra }));

async function main() {
  if (process.env.BACKUP_DIR_SET === '') {
    log('refused', { message: 'BACKUP_DIR is empty in .env: set it to the backup folder and start again' });
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? '/data';
  const backupDir = process.env.BACKUP_TARGET ?? '/backup';
  const configPath = process.env.LITESTREAM_CONFIG ?? '/tmp/litestream.yml';
  const everyMs = Number(process.env.BACKUP_INTERVAL_S ?? '60') * 1000;
  let child = null;
  let stopping = false;
  const stop = () => {
    stopping = true;
    child?.kill('SIGTERM');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const start = () => {
    child = spawn('litestream', ['replicate', '-config', configPath], { stdio: 'inherit' });
    child.on('exit', (code) => {
      log('litestream-exit', { code });
      child = null;
    });
  };
  const stopChild = () =>
    new Promise((resolve) => {
      if (!child) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  while (!stopping) {
    const r = refreshConfig({ dataDir, backupDir, configPath });
    if (r.changed) {
      log('config', { databases: r.databases });
      await stopChild();
      start();
    } else if (!child && r.databases.length > 0) start();
    const round = backupRound({ dataDir, backupDir });
    if (round.files.copied || round.files.removed) log('files', round.files);
    for (const p of round.problems) log('problem', { message: p });
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  await stopChild();
}

if (process.argv[1]?.endsWith('run.mjs')) await main();
