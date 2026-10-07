// WP-612: a preference record never appears in sync pages or in a subject export.
import { afterEach, describe, expect, it } from 'vitest';
import { exportSubject } from '../export-subject';
import { world as exportWorld, type World } from '../export-subject/world.testkit';
import { collectBytes, readZip } from '../export-subject/zip-reader.testkit';
import { setupHttp } from '../http/sync/testkit';
import { createPrefsStore } from './store';

const SENTINEL = 'SENTINEL-PREF-VALUE';
const NOW = '2026-10-01T08:00:00.000Z';
const entry = { path: 'tool_prefs.chat.note', value: SENTINEL, at: NOW };

const disposables: World[] = [];
afterEach(() => {
  for (const w of disposables.splice(0)) w.dispose();
});

describe('preferences stay out of sync and exports', () => {
  it('a sync page is the same before and after a preference write, and never names it', () => {
    const h = setupHttp();
    const before = JSON.stringify(h.ctx.service.page(h.annaActor, { since: 0, scope: '', v: 1 }));
    const head = h.ctx.service.head();
    createPrefsStore(h.ctx.db, { now: () => NOW }).patch('anna', [entry]);
    expect(h.ctx.service.head()).toBe(head);
    const after = JSON.stringify(h.ctx.service.page(h.annaActor, { since: 0, scope: '', v: 1 }));
    expect(after).toBe(before);
    expect(after).not.toContain(SENTINEL);
  });

  it('a subject export holds no preference', async () => {
    const w = exportWorld();
    disposables.push(w);
    w.participant('p1', 'Anna');
    w.run('r1', 'p1');
    w.obs('r1', 'f1', 'titel', 'Loch');
    createPrefsStore(w.db, { now: () => NOW }).patch('p1', [entry]);
    const zip = readZip(await collectBytes(exportSubject(w.project, 'p1', 'admin-1')));
    const dec = new TextDecoder();
    for (const [name, bytes] of zip) {
      expect(name).not.toContain('pref');
      expect(dec.decode(bytes)).not.toContain(SENTINEL);
    }
  });
});
