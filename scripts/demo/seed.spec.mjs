// WP-994: what `ctl.ts seed` puts into the data dir matches plan.json (no deploy needed).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ctl } from './demo.mjs';

const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ub-demo-seed-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ctl seed', () => {
  it('every participant gets its plan name, not its id', () => {
    ctl('seed', dir);
    for (const p of plan.projects) {
      const db = new DatabaseSync(join(dir, `project-${p.key}.db`), { readOnly: true });
      const rows = db.prepare('SELECT id, name FROM participants').all();
      db.close();
      for (const who of p.participants)
        expect(rows.find((r) => r.id === who.id)?.name, `${p.key} ${who.id}`).toBe(who.name);
    }
  }, 120_000);

  it('the newest 1.x of the Baumkataster template is published', () => {
    ctl('seed', dir);
    const db = new DatabaseSync(join(dir, 'control.db'), { readOnly: true });
    const versions = db.prepare("SELECT version FROM templates WHERE key = 'baumkataster'").all();
    db.close();
    expect(versions.map((v) => v.version)).toContain('1.1.0');
  }, 120_000);
});
