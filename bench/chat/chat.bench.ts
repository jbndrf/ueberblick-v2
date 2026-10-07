/**
 * Budget (WP-682, B-020): the Projekt-Chat stream of a project with 100k messages. One page of 200 messages (with their
 * mention index) and one append (with mention extraction and indexing) each answer in <= 50 ms p95 at the handler. They
 * derive from the "Run endpoint p95" row of docs/12 and are not table rows.
 * Run: npm test -- -c bench/vitest.config.ts bench/chat
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { chatWorld } from '../../packages/server/src/modules/chat/chat.testkit';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;
const budget = (id: string) =>
  defineBudget({
    id,
    limit: 50,
    unit: 'ms',
    derivedFrom: 'Run endpoint p95 (docs/12): one small indexed read or write on one vCPU',
    device: 'server',
  });

describe('bench: chat stream', () => {
  it('a page of 200 from 100k messages, and an append', async () => {
    const w = await chatWorld();
    const insert = w.db.prepare('INSERT INTO messages (id, tool, author, at, body) VALUES (?, ?, ?, ?, ?)');
    const person = w.db.prepare('INSERT INTO message_persons (seq, person_id) VALUES (?, ?)');
    w.db.transaction(() => {
      for (let i = 0; i < 100_000; i++) {
        const r = insert.run(
          `m-${String(i).padStart(10, '0')}`,
          'chat',
          i % 2 ? 'mia' : 'bernd',
          '2026-10-02T08:00:00.000Z',
          `Nachricht ${i} @lena`,
        );
        if (i % 3 === 0) person.run(Number(r.lastInsertRowid), 'lena');
      }
    });
    const pages: number[] = [];
    for (let i = 0; i < 40; i++) {
      const after = Math.floor(Math.random() * 99_000);
      const t = performance.now();
      const r = await w.request('list', { cookie: w.cookies.mia, query: `?after=${after}&limit=200` });
      await r.text();
      pages.push(performance.now() - t);
    }
    const tail: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      const r = await w.request('list', { cookie: w.cookies.mia, query: '?after=99800&limit=200' });
      await r.text();
      tail.push(performance.now() - t);
    }
    const appends: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t = performance.now();
      await w.send(w.cookies.mia, `bench-${String(i).padStart(8, '0')}`, `Hallo @lena @bernd #f-${i}`);
      appends.push(performance.now() - t);
    }
    const page = p95([...pages, ...tail]);
    const append = p95(appends);
    console.log(`chat 100k: page of 200 p95 ${page.toFixed(1)} ms, append p95 ${append.toFixed(1)} ms`);
    assertBudget(report(budget('chat-page-100k-p95'), Number(page.toFixed(1))));
    assertBudget(report(budget('chat-append-p95'), Number(append.toFixed(1))));
  }, 120_000);
});
