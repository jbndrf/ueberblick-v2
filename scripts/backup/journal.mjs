// Erasure journal: what a restore must re-apply. `erasure_subjects` lives inside each project database, so a snapshot
// from before an erasure does not carry it. The journal is exported from the LIVE data directory (cron, or after
// every erasure) and stored OUTSIDE the replica. It holds ids only (subjects, feature ids, property keys), never values.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { discoverDatabases } from './config.mjs';

const SEPARATOR = '#'; // core `redactionKey`: `${featureId}#${property}`, the feature id has no '#'

/**
 * Only the input fields whose value IS one of the run's subjects (an id). A form can carry free text (a reason, a
 * confirmation) and the journal must never hold anything but ids, so every other field is dropped.
 */
function idsOnly(input, subjects) {
  if (input === null) return null;
  const parsed = JSON.parse(input);
  if (parsed === null || typeof parsed !== 'object') return null;
  return Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => typeof v === 'string' && subjects.includes(v)),
  );
}

/**
 * The journal entry of one open project database (read-only use): one erasure per (ORIGINAL ERASURE RUN, subject), so a replay
 * keeps who was erased under which subject. Erasure runs are the ones `createErasure.erase` recorded in
 * `erasure_runs` (never guessed from a run's input); `task` and `input` (only the input fields that hold a subject id; free text never reaches the journal) are what a replay submits again (`created` is the feature id the run created, so the replay recreates it under the same id); the pairs are the null observations of that run. Ids and times
 * only, never values.
 */
export function journalEntry(raw) {
  const runs = raw
    .prepare(
      `SELECT r.id, r.actor, r.actor_kind AS actorKind, r.task, r.input, r.received_at AS erasedAt, e.subject AS subject
       FROM erasure_runs e JOIN runs r ON r.id = e.run_id
       ORDER BY (SELECT min(seq) FROM observations o WHERE o.run_id = r.id), r.id, e.subject`,
    )
    .all();
  const pairsOf = raw.prepare(
    "SELECT DISTINCT feature_id AS featureId, property FROM observations WHERE run_id = ? AND result = 'null' ORDER BY feature_id, property",
  );
  const createdOf = raw.prepare(
    "SELECT feature_id AS id FROM observations WHERE run_id = ? AND property = '$type' ORDER BY seq LIMIT 1",
  );
  const subjectsOf = new Map();
  for (const r of runs) subjectsOf.set(r.id, [...(subjectsOf.get(r.id) ?? []), r.subject]);
  const erasures = runs.map((r) => ({
    subject: r.subject,
    sourceRun: r.id,
    actor: r.actor,
    actorKind: r.actorKind,
    task: r.task,
    input: idsOnly(r.input, subjectsOf.get(r.id) ?? []),
    erasedAt: r.erasedAt,
    created: createdOf.get(r.id)?.id ?? null,
    pairs: pairsOf.all(r.id),
  }));
  const covered = new Set(
    erasures.flatMap((e) => e.pairs.map((p) => `${p.featureId}${SEPARATOR}${p.property}`)),
  );
  for (const t of raw.prepare("SELECT id FROM tombstones WHERE kind = 'redaction'").all())
    if (!covered.has(t.id)) throw new Error(`cannot attribute redaction ${t.id} to an erasure run`);
  return { erasures };
}

/** Journal of every project database in `dataDir`. */
export function exportJournal(dataDir) {
  const projects = {};
  for (const file of discoverDatabases(dataDir).filter((f) => f !== 'control.db')) {
    const raw = new Database(join(dataDir, file), { readonly: true, fileMustExist: true });
    try {
      projects[file] = journalEntry(raw);
    } finally {
      raw.close();
    }
  }
  return { version: 1, projects };
}

if (process.argv[1]?.endsWith('journal.mjs')) {
  const [dataDir, out] = process.argv.slice(2);
  const usage =
    'usage: node scripts/backup/journal.mjs <data-dir> [out.json]   (store the file OUTSIDE the replica)';
  if (dataDir === '--help' || dataDir === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (!dataDir) {
    console.error(usage);
    process.exit(2);
  }
  const text = JSON.stringify(exportJournal(dataDir), null, 2) + '\n';
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}
