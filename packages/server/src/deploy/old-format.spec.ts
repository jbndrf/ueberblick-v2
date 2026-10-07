import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { openControlDb, openProjectDb } from '../db/open';

import { deploy, loadConfig, OldFormatRulesError } from './index';
import { controlCatalog } from '../templates/publish-version';
import { controlTemplateSource } from '../templates/templates';

const clock = { now: () => '2026-10-05T10:00:00Z' };
const base: TemplateFile = {
  schema: 'ueberblick/1',
  template: { key: 'demo', version: '1.0.0' },
  types: { baum: { label: 'Baum', geometry: 'point', properties: { art: { type: 'text' } } } },
  tasks: { melden: { label: 'Melden', on: 'baum', form: { art: {} } } },
};

describe('stored data from before C-004 (top-level rules:)', () => {
  it('a stored version with an old format and rules: refuses to load, naming project and version', () => {
    const db = openProjectDb(':memory:', 'rathaus');
    deploy(db, base, 'a', { clock });
    const row = db
      .prepare<{ compiled: string }>('SELECT compiled FROM config_versions WHERE version = 1')
      .get();
    const old = JSON.parse(row?.compiled ?? '{}') as { file: object };
    old.file = { ...old.file, rules: { r: { on: 'task.melden', run: 'melden' } } };
    const stale = { ...old, format: 0 };
    db.prepare('UPDATE config_versions SET compiled = ? WHERE version = 1').run(JSON.stringify(stale));
    expect(() => loadConfig(db, 1)).toThrow(OldFormatRulesError);
    expect(() => loadConfig(db, 1)).toThrow(
      /old_format_rules: project .+ version 1 still has rules: — re-seed or migrate/,
    );
  });

  it('the message names the project of a file database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'old-format-'));
    try {
      const db = openProjectDb(dir, 'rathaus');
      deploy(db, base, 'a', { clock });
      const row = db
        .prepare<{ compiled: string }>('SELECT compiled FROM config_versions WHERE version = 1')
        .get();
      const old = { ...JSON.parse(row?.compiled ?? '{}'), format: 0 };
      old.file = { ...old.file, rules: {} };
      db.prepare('UPDATE config_versions SET compiled = ? WHERE version = 1').run(JSON.stringify(old));
      expect(() => loadConfig(db, 1)).toThrow('old_format_rules: project rathaus version 1 still has rules:');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('another project on the same server keeps loading', () => {
    const good = openProjectDb(':memory:', 'ok');
    deploy(good, base, 'a', { clock });
    expect(loadConfig(good, 1)?.file.template?.key).toBe('demo');
  });

  it('a stored template source with rules: is a named error, not a ZodError', () => {
    const control = openControlDb(':memory:');
    const source = JSON.stringify({ ...base, rules: { r: {} } });
    control
      .prepare('INSERT INTO templates (key, version, source, compiled, published_at) VALUES (?,?,?,?,?)')
      .run('demo', '1.0.0', source, '{}', clock.now());
    expect(() => controlTemplateSource(control).resolve('demo@1')).toThrow(
      'old_format_rules: template demo version 1.0.0 still has rules: — re-seed or migrate',
    );
    expect(() => controlCatalog(control).versionsOf('demo')).toThrow(OldFormatRulesError);
  });
});
