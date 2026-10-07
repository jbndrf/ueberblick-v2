import { describe, expect, it } from 'vitest';
import { openProjectDb } from '../../db/open';
import { createErasure } from '../../erasure';
import { exportSubject } from '../../export-subject';
import { collectBytes, readZip } from '../../export-subject/zip-reader.testkit';
import { world } from '../../export-subject/world.testkit';
import { PROJECT_MIGRATIONS } from '../../db/project-schema';
import { createChatStore, REMOVED_MARK } from './store';

const NOW = '2026-10-02T08:00:00.000Z';
const F = 'f-tree-1';

function seeded() {
  const db = openProjectDb(':memory:', 'demo');
  for (const p of ['anna', 'ben', 'cleo'])
    db.prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)').run(p, p, '[]');
  for (const f of [F, 'f-tree-2'])
    db.prepare(
      'INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, ?, 1, ?, 1)',
    ).run(f, 'baum', '{}');
  const chat = createChatStore(db, { now: () => NOW });
  chat.append('chat', 'anna', 'id-anna-001', 'Ich bin Anna, siehe #f-tree-1');
  chat.append('chat', 'ben', 'id-ben-0001', 'Hallo @anna und @cleo');
  chat.append('chat', 'cleo', 'id-cleo-001', 'Zum Baum #f-tree-1 und #f-tree-2');
  chat.append('chat', 'cleo', 'id-cleo-002', 'nichts');
  return { db, chat };
}

const bodies = (db: ReturnType<typeof seeded>['db']): string[] =>
  db
    .prepare<{ body: string }>('SELECT body FROM messages ORDER BY id')
    .all()
    .map((r) => r.body);
const count = (db: ReturnType<typeof seeded>['db'], t: string): number =>
  (db.prepare<{ n: number }>(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;

describe('migration', () => {
  it('is one numbered entry of PROJECT_MIGRATIONS with a unique id', () => {
    const ids = PROJECT_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROJECT_MIGRATIONS.some((m) => m.name === 'chat_messages')).toBe(true);
  });
});

describe('erasure (B-005)', () => {
  it('by author: the message becomes a removed row (no author, no body, no index rows), others stay', () => {
    const { db } = seeded();
    createErasure(db).erase({ subject: 'cleo', purge: [], erasureRun: 'e1', at: NOW });
    const rows = db
      .prepare<{ author: string; body: string; removed: number }>(
        'SELECT author, body, removed FROM messages ORDER BY id',
      )
      .all();
    expect(rows.filter((r) => r.removed === 1)).toEqual([
      { author: '', body: '', removed: 1 },
      { author: '', body: '', removed: 1 },
    ]);
    expect(bodies(db).filter(Boolean)).toEqual([
      'Ich bin Anna, siehe #f-tree-1',
      'Hallo @anna und @cleo'.replace('@cleo', REMOVED_MARK),
    ]);
    expect(count(db, 'message_features')).toBe(1); // only Anna's #f-tree-1 is left
  });

  it('re-delivers: every erased or redacted message gets a new seq above the old head, so a pull after it sees it', () => {
    const { db, chat } = seeded();
    const before = chat.head('chat');
    createErasure(db).erase({ subject: 'cleo', purge: [], erasureRun: 'e1', at: NOW });
    const again = chat.list('chat', before, 100);
    expect(again.map((m) => m.id)).toEqual(['id-ben-0001', 'id-cleo-001', 'id-cleo-002']);
    expect(again.map((m) => [m.removed, m.body, m.author])).toEqual([
      [false, `Hallo @anna und ${REMOVED_MARK}`, 'ben'],
      [true, null, null],
      [true, null, null],
    ]);
    // the next append continues above the bumped seqs
    const next = chat.append('chat', 'anna', 'id-anna-002', 'neu');
    expect(next.message.seq).toBeGreaterThan(chat.head('chat') - 1);
    expect(chat.list('chat', before, 100).map((m) => m.seq)).toEqual(
      [...chat.list('chat', before, 100).map((m) => m.seq)].sort((x, y) => x - y),
    );
  });

  it('by mentioned person: the token is cut from other bodies and the index, the message stays', () => {
    const { db } = seeded();
    createErasure(db).erase({ subject: 'anna', purge: [], erasureRun: 'e1', at: NOW });
    expect(bodies(db)).toEqual([
      '', // Anna's own message is a removed row
      `Hallo ${REMOVED_MARK} und @cleo`,
      'Zum Baum #f-tree-1 und #f-tree-2',
      'nichts',
    ]);
    expect(db.prepare("SELECT 1 FROM message_persons WHERE person_id = 'anna'").get()).toBeUndefined();
  });

  it('a redacted message keeps its other mention index rows after its seq moved', () => {
    const { db, chat } = seeded();
    createErasure(db).erase({ subject: 'anna', purge: [], erasureRun: 'e1', at: NOW });
    const ben = chat.list('chat', 0, 100).find((m) => m.id === 'id-ben-0001');
    expect(ben?.mentions.persons).toEqual(['cleo']);
  });

  it('by mentioned feature: the token is cut from the bodies and the index, other mentions stay', () => {
    const { db } = seeded();
    createErasure(db).erase({ subject: F, purge: [], erasureRun: 'e1', at: NOW });
    expect(bodies(db)).toEqual([
      `Ich bin Anna, siehe ${REMOVED_MARK}`,
      'Hallo @anna und @cleo',
      `Zum Baum ${REMOVED_MARK} und #f-tree-2`,
      'nichts',
    ]);
    expect(db.prepare<{ feature_id: string }>('SELECT feature_id FROM message_features').all()).toEqual([
      { feature_id: 'f-tree-2' },
    ]);
  });

  it('drops the read state of the person, and a second erasure changes nothing', () => {
    const { db, chat } = seeded();
    chat.markRead('anna', 'chat', 3, 3);
    createErasure(db).erase({ subject: 'anna', purge: [], erasureRun: 'e1', at: NOW });
    expect(count(db, 'chat_reads')).toBe(0);
    const before = JSON.stringify(db.prepare('SELECT * FROM messages').all());
    createErasure(db).erase({ subject: 'anna', purge: [], erasureRun: 'e2', at: NOW });
    expect(JSON.stringify(db.prepare('SELECT * FROM messages').all())).toBe(before);
  });
});

describe('export of the subject (B-005)', () => {
  const dec = new TextDecoder();
  const rows = (b: Uint8Array | undefined) =>
    dec
      .decode(b)
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { body: string; via: string });

  async function messages(subject: string) {
    const w = world();
    const chat = createChatStore(w.db, { now: () => NOW });
    w.participant('anna', 'Anna');
    w.participant('ben', 'Ben');
    w.feature('f1', 'person');
    chat.append('chat', 'anna', 'id-anna-001', 'von Anna');
    chat.append('chat', 'ben', 'id-ben-0001', 'an @anna');
    chat.append('chat', 'ben', 'id-ben-0002', 'zu #f1');
    chat.append('chat', 'ben', 'id-ben-0003', 'unbeteiligt');
    const z = readZip(await collectBytes(exportSubject(w.project, subject, 'admin-1')));
    const manifest = JSON.parse(dec.decode(z.get('manifest.json'))) as {
      files: { path: string; kind: string; records?: number }[];
    };
    w.dispose();
    return { out: rows(z.get('messages.ndjson')), manifest };
  }

  it('by author and by mentioned person: own messages and those that mention the person', async () => {
    const { out, manifest } = await messages('anna');
    expect(out.map((m) => [m.body, m.via])).toEqual([
      ['von Anna', 'author'],
      ['an @anna', 'mentioned'],
    ]);
    expect(manifest.files.find((f) => f.path === 'messages.ndjson')).toMatchObject({
      kind: 'messages',
      records: 2,
    });
  });

  it('by mentioned feature: the messages that mention the feature', async () => {
    const { out } = await messages('f1');
    expect(out.map((m) => [m.body, m.via])).toEqual([['zu #f1', 'mentioned']]);
  });
});
