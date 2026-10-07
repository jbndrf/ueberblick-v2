// WP-142.2: the erasure journal holds ids only, one entry per (erasure run, subject).
import { describe, expect, it } from 'vitest';
import { openProjectDb } from '../../packages/server/src/db/open';
import { journalEntry } from './journal.mjs';

describe('journalEntry', () => {
  it('one run that erased two subjects gives one journal entry per subject', () => {
    const db = openProjectDb(':memory:', 'x');
    db.exec(`INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
      VALUES ('r1', 'root', 'admin', 'erase_two', 1, '{"a":"anna","b":"bob"}', '2026-10-01T08:00:00.000Z', 'accepted');
      INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (1, 'r1', 'f1', 'phone', 'null');
      INSERT INTO tombstones (seq, kind, id) VALUES (2, 'redaction', 'f1#phone');
      INSERT INTO erasure_runs VALUES ('r1', 'anna', '2026-10-01T08:00:00.000Z'), ('r1', 'bob', '2026-10-01T08:00:00.000Z')`);
    expect(journalEntry(db).erasures.map((e) => [e.subject, e.sourceRun, e.task])).toEqual([
      ['anna', 'r1', 'erase_two'],
      ['bob', 'r1', 'erase_two'],
    ]);
  });

  it('the journal keeps only the input fields that are subject ids, never free text', () => {
    const db = openProjectDb(':memory:', 'x');
    db.exec(`INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
      VALUES ('r1', 'root', 'admin', 'erase_two', 1, '{"a":"anna","b":"bob","reason":"Anna Muster called from 0151","n":5}', '2026-10-01T08:00:00.000Z', 'accepted');
      INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (1, 'r1', 'f1', 'phone', 'null');
      INSERT INTO tombstones (seq, kind, id) VALUES (2, 'redaction', 'f1#phone');
      INSERT INTO erasure_runs VALUES ('r1', 'anna', '2026-10-01T08:00:00.000Z'), ('r1', 'bob', '2026-10-01T08:00:00.000Z')`);
    const { erasures } = journalEntry(db);
    expect(erasures.map((e) => e.input)).toEqual([
      { a: 'anna', b: 'bob' },
      { a: 'anna', b: 'bob' },
    ]);
    expect(JSON.stringify(erasures)).not.toContain('0151');
  });

  it('refuses loudly to export a redaction no erasure run explains (never guesses)', () => {
    const db = openProjectDb(':memory:', 'x');
    db.exec("INSERT INTO tombstones (seq, kind, id) VALUES (1, 'redaction', 'f1#phone')");
    expect(() => journalEntry(db)).toThrow(/cannot attribute redaction f1#phone/);
  });
});
