// Writes the manifest (row counts, max(seq)) of a live data directory to stdout. Reads only, never writes.
import { fileURLToPath } from 'node:url';
import { buildManifest } from './verify.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('usage: node scripts/backup/manifest.mjs <data-dir> > manifest.json');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(buildManifest(dataDir), null, 2) + '\n');
}
