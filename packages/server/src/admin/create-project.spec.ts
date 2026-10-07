import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { createAuth } from '../auth';
import { ensureDraft } from '../builder-draft';
import { assertProjectKey, openControlDb, openProjectDb, ReservedProjectKey } from '../db/open';
import { RESERVED_PROJECT_KEYS } from '@ueberblick/core';
import { createProject } from './bootstrap';
import { plan } from '../deploy';
import { controlTemplateSource, listTemplates, publishTemplate } from '../templates';
import { createProjectFromTemplate, projectKeyFromName, validateNewProject } from './create-project';

const golden = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as TemplateFile;

const clock = { now: () => '2026-10-01T08:00:00Z' };

async function world() {
  const control = openControlDb(':memory:');
  const auth = createAuth({ control, now: () => new Date(0), participantRoles: () => [] });
  const accountId = await auth.createAdmin('a@example.org', 'correct horse battery');
  const dbs = new Map<string, ReturnType<typeof openProjectDb>>();
  const opener = (key: string) => {
    let db = dbs.get(key);
    if (!db) dbs.set(key, (db = openProjectDb(':memory:', key)));
    return db;
  };
  return { control, accountId, opener, auth };
}
const input = (over: Partial<{ name: string; description: string; template: string }> = {}) => ({
  name: 'Musterstadt',
  description: 'Bäume der Stadt',
  template: 'leer@1',
  ...over,
});

describe('createProjectFromTemplate', () => {
  it('leer: project row with description, migrated DB, draft extending leer@1, no version, a membership', async () => {
    const { control, accountId, opener, auth } = await world();
    const r = createProjectFromTemplate(control, opener, input(), accountId, clock);
    expect(r.key).toBe('musterstadt');
    const row = control
      .prepare<{ id: string; name: string; description: string }>(
        'SELECT id, name, description FROM projects WHERE key = ?',
      )
      .get(r.key);
    expect(row).toEqual({ id: r.id, name: 'Musterstadt', description: 'Bäume der Stadt' });
    const db = opener(r.key);
    expect(db.prepare('SELECT count(*) AS n FROM config_versions').get()).toEqual({ n: 0 });
    const draft = ensureDraft(db, clock, 'x');
    expect(draft.ok && draft.draft.template).toBe('leer');
    expect(draft.ok && parse(draft.draft.overlay)).toEqual({ schema: 'ueberblick/1', extends: 'leer@1' });
    expect(auth.rolesFor(accountId, r.id)).toHaveLength(1);
  });

  it('golden baumkataster: the draft compiles and carries the template types', async () => {
    const { control, accountId, opener } = await world();
    publishTemplate(control, golden, clock);
    const r = createProjectFromTemplate(
      control,
      opener,
      input({ template: 'baumkataster@1' }),
      accountId,
      clock,
    );
    const draft = ensureDraft(opener(r.key), clock, 'x');
    if (!draft.ok) throw new Error('no draft');
    const overlay = parse(draft.draft.overlay) as OverlayFile;
    const res = plan(openProjectDb(':memory:', 'probe'), overlay, {
      clock,
      templates: controlTemplateSource(control),
    });
    expect(res.ok).toBe(true);
    expect(draft.draft.template).toBe('baumkataster');
    expect(Object.keys(golden.types ?? {}).length).toBeGreaterThan(0);
  });

  it('keys: umlauts are slugged, a second project of the same name gets a distinct key', async () => {
    const { control, accountId, opener } = await world();
    expect(projectKeyFromName('Bäume Süd-Ost ß')).toBe('baeume_sued_ost_ss');
    const a = createProjectFromTemplate(
      control,
      opener,
      input({ name: 'Baumkataster Nord' }),
      accountId,
      clock,
    );
    const b = createProjectFromTemplate(
      control,
      opener,
      input({ name: 'Baumkataster Nord' }),
      accountId,
      clock,
    );
    expect(a.key).toBe('baumkataster_nord');
    expect(b.key).not.toBe(a.key);
    expect(b.key).toMatch(/^baumkataster_nord_\d+$/);
  });

  it('a key never contains __ (a preview is served as <key>__vorschau, A-031)', () => {
    const names = [
      'a__b',
      '__x__',
      'Bäume__Süd',
      'x - _ - y',
      '_',
      '123__456',
      `${'ab_'.repeat(30)}__cd`,
      'vorschau__',
    ];
    for (const n of names) expect(projectKeyFromName(n)).not.toContain('__');
  });

  it('a name without letters still yields a valid key', () => {
    expect(projectKeyFromName('123 !!')).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('refuses an empty name and an unknown template with field problems', async () => {
    const { control, accountId, opener } = await world();
    expect(validateNewProject(control, input({ name: '  ' }), clock)).toEqual([
      { field: 'name', message: expect.any(String) },
    ]);
    expect(validateNewProject(control, input({ template: 'nope@1' }), clock)[0]?.field).toBe('template');
    expect(validateNewProject(control, input({ template: 'garbage' }), clock)[0]?.field).toBe('template');
    expect(() => createProjectFromTemplate(control, opener, input({ name: '' }), accountId, clock)).toThrow();
  });
});

describe('ensureDraft without a version', () => {
  it('answers no_version when there is neither a draft nor a version', () => {
    const db = openProjectDb(':memory:', 'x');
    expect(ensureDraft(db, clock, 'a')).toEqual({ ok: false, code: 'no_version' });
  });
});

describe('listTemplates', () => {
  it('lists the newest version per key, leer first, with en and de labels', async () => {
    const { control } = await world();
    publishTemplate(control, golden, clock);
    publishTemplate(control, { ...golden, template: { ...golden.template, version: '1.1.0' } }, clock);
    const list = listTemplates(control, clock);
    expect(list[0]).toMatchObject({
      key: 'leer',
      version: '1.0.0',
      label: { de: 'Leeres Projekt', en: 'Empty project' },
    });
    const bk = list.filter((t) => t.key === 'baumkataster');
    expect(bk).toHaveLength(1);
    expect(bk[0]?.version).toBe('1.1.0');
    expect(bk[0]?.label.de).toBeTruthy();
    expect(bk[0]?.label.en).toBeTruthy();
  });
});

describe('reserved project keys (WP-424)', () => {
  it.each(['Tiles', 'packs'])(
    'a project named %s never gets the reserved key (create and ZIP import share this path)',
    async (name) => {
      const { control, accountId, opener } = await world();
      const r = createProjectFromTemplate(control, opener, input({ name }), accountId, clock);
      expect(r.key).toBe(`${name.toLowerCase()}_2`);
    },
  );

  it('assertProjectKey and createProject refuse them with a typed error', () => {
    for (const key of RESERVED_PROJECT_KEYS) {
      expect(() => assertProjectKey(key)).toThrow(ReservedProjectKey);
      expect(() => createProject(openControlDb(':memory:'), { key, name: 'x' }, clock)).toThrow(
        ReservedProjectKey,
      );
    }
  });
});
