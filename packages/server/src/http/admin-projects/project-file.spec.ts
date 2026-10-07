import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { createAuth } from '../../auth';
import { createDraftStore } from '../../builder-draft';
import { openControlDb, openProjectDb } from '../../db/open';
import { deploy } from '../../deploy';
import { createProjectFromTemplate } from '../../admin/create-project';
import {
  controlCatalog,
  controlTemplateSource,
  publishTemplate,
  publishTemplateVersion,
} from '../../templates';
import {
  effectiveDeployedFile,
  effectiveDraftFile,
  importProjectFile,
  templateFromProject,
} from './project-file';

const golden = <T>(rel: string): T =>
  embedGoldenRefs(
    parse(
      readFileSync(fileURLToPath(new URL(`../../../../../fixtures/golden/${rel}`, import.meta.url)), 'utf8'),
    ),
  ) as T;
const clock = { now: () => '2026-10-02T08:00:00Z' };
const base = golden<TemplateFile>('templates/baumkataster/1.0.0.yaml');
const overlay = golden<OverlayFile>('projects/musterstadt-baeume.yaml');

async function world() {
  const control = openControlDb(':memory:');
  const auth = createAuth({ control, now: () => new Date(0), participantRoles: () => [] });
  const by = await auth.createAdmin('a@example.org', 'correct horse battery');
  const dbs = new Map<string, ReturnType<typeof openProjectDb>>();
  const open = (key: string) => {
    let db = dbs.get(key);
    if (!db) dbs.set(key, (db = openProjectDb(':memory:', key)));
    return db;
  };
  publishTemplate(control, base, clock);
  return { control, by, open, deps: { control, openProjectDb: open, clock } };
}

const NEW = { name: 'Muster', description: '', template: 'baumkataster@1' };

describe('effective file of a project', () => {
  it('the draft: template and overlay resolved into one template file', async () => {
    const { control, by, open } = await world();
    const p = createProjectFromTemplate(control, open, NEW, by, clock);
    const r = effectiveDraftFile(open(p.key), controlTemplateSource(control));
    expect(r.ok && r.file).toEqual(base);
  });

  it('a draft whose overlay does not read is a problem list, not a throw', async () => {
    const { control, by, open } = await world();
    const p = createProjectFromTemplate(control, open, NEW, by, clock);
    createDraftStore(open(p.key)).putIf(1, 'extends: [', by, clock.now());
    const r = effectiveDraftFile(open(p.key), controlTemplateSource(control));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.length).toBeGreaterThan(0);
  });

  it('the deployed file: not_published while nothing is deployed, else the resolved file', async () => {
    const { control, by, open } = await world();
    const p = createProjectFromTemplate(control, open, NEW, by, clock);
    const db = open(p.key);
    const none = effectiveDeployedFile(db);
    expect(!none.ok && none.code).toBe('not_published');
    const templates = controlTemplateSource(control);
    expect(deploy(db, overlay, by, { clock, templates }).ok).toBe(true);
    const r = effectiveDeployedFile(db);
    expect(r.ok && r.file.template.key).toBe('baumkataster');
    expect(r.ok && Object.keys(r.file.types ?? {}).length).toBeGreaterThan(0);
  });

  it('templateFromProject sets the template identity and keeps the content', () => {
    const t = templateFromProject(base, { key: 'meine', version: '1.0.0', label: { de: 'Meine' } });
    expect(t.template).toEqual({ key: 'meine', version: '1.0.0', label: { de: 'Meine' } });
    expect(t.types).toEqual(base.types);
  });
});

describe('importProjectFile', () => {
  it('an overlay file creates an unpublished project whose draft is that overlay', async () => {
    const { control, by, open, deps } = await world();
    const r = importProjectFile(deps, stringify(overlay), by, 'Aus Datei');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db = open(r.key);
    expect(db.prepare('SELECT count(*) AS n FROM config_versions').get()).toEqual({ n: 0 });
    const draft = createDraftStore(db).get();
    expect(draft && parse(draft.overlay)).toEqual(overlay);
    expect(control.prepare('SELECT name FROM projects WHERE key = ?').get(r.key)).toEqual({
      name: 'Aus Datei',
    });
  });

  it('JSON is read as well (YAML is a superset)', async () => {
    const { by, deps } = await world();
    expect(importProjectFile(deps, JSON.stringify(overlay), by).ok).toBe(true);
  });

  it('a template file is published as a template and the project extends it', async () => {
    const { control, by, open, deps } = await world();
    const file: TemplateFile = { ...base, template: { ...base.template, key: 'andere' } };
    const r = importProjectFile(deps, stringify(file), by);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(controlTemplateSource(control).resolve('andere@1')).toEqual(file);
    const draft = createDraftStore(open(r.key)).get();
    expect(draft && parse(draft.overlay)).toEqual({ schema: 'ueberblick/1', extends: 'andere@1.0.0' });
  });

  it('the real gate refuses a minor that removes a property (breaking_in_minor) and creates nothing', async () => {
    const { control, by, deps } = await world();
    const baum = base.types?.['baum'];
    if (baum === undefined) throw new Error('fixture has no baum type');
    const extra = { type: 'text', label: { de: 'Zusatz' } } as unknown as NonNullable<
      typeof baum.properties
    >[string];
    const v1: TemplateFile = {
      ...base,
      template: { ...base.template, key: 'andere', version: '1.0.0' },
      types: { ...base.types, baum: { ...baum, properties: { ...baum.properties, zusatz: extra } } },
    };
    const v2: TemplateFile = {
      ...base,
      template: { ...base.template, key: 'andere', version: '1.1.0' },
    };
    expect(publishTemplate(control, v1, clock).ok).toBe(true);
    const count = (table: string) => control.prepare(`SELECT count(*) AS n FROM ${table}`).get();
    const [projects, templates] = [count('projects'), count('templates')];
    const r = importProjectFile(deps, stringify(v2), by);
    expect(!r.ok && r.problems.some((p) => p.message.includes('types.baum.properties.zusatz'))).toBe(true);
    expect(count('projects')).toEqual(projects);
    expect(count('templates')).toEqual(templates);
    const direct = publishTemplateVersion(control, controlCatalog(control), clock, stringify(v2));
    expect(direct).toMatchObject({ ok: false, reason: 'refused', codes: ['breaking_in_minor'] });
  });

  it('the project extends the exact imported version, not a higher minor of the same major', async () => {
    const { control, by, open, deps } = await world();
    const v1: TemplateFile = { ...base, template: { ...base.template, key: 'andere', version: '1.0.0' } };
    const v2: TemplateFile = { ...v1, template: { ...v1.template, version: '1.2.0' } };
    expect(publishTemplate(control, v1, clock).ok && publishTemplate(control, v2, clock).ok).toBe(true);
    const r = importProjectFile(deps, stringify(v1), by);
    if (!r.ok) throw new Error('import failed');
    const draft = createDraftStore(open(r.key)).get();
    expect(draft?.templateVersion).toBe('1.0.0');
    expect(draft && parse(draft.overlay)).toEqual({ schema: 'ueberblick/1', extends: 'andere@1.0.0' });
    const eff = effectiveDraftFile(open(r.key), controlTemplateSource(control));
    expect(eff.ok && eff.file.template.version).toBe('1.0.0');
  });

  it('a template file equal to the stored version in another key order is no conflict', async () => {
    const { by, deps } = await world();
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as TemplateFile;
    expect(importProjectFile(deps, stringify(reordered), by).ok).toBe(true);
    const changed = { ...base, tools: { x: {} } };
    const r = importProjectFile(deps, stringify(changed), by);
    expect(!r.ok && r.problems[0]?.path).toBe('template');
  });

  it('an invalid file lists its problems and creates nothing', async () => {
    const { control, by, deps } = await world();
    const projects = () => control.prepare('SELECT count(*) AS n FROM projects').get();
    const templates = () => control.prepare('SELECT count(*) AS n FROM templates').get();
    const [p0, t0] = [projects(), templates()];
    const notYaml = importProjectFile(deps, 'a: [', by);
    expect(!notYaml.ok && notYaml.problems.length).toBeGreaterThan(0);
    expect(importProjectFile(deps, stringify({ schema: 'ueberblick/1', hello: 1 }), by).ok).toBe(false);
    const dangling = importProjectFile(
      deps,
      stringify({ schema: 'ueberblick/1', extends: 'gibtsnicht@1' }),
      by,
    );
    expect(!dangling.ok && dangling.problems[0]?.path).toBe('extends');
    const broken = importProjectFile(
      deps,
      stringify({ ...overlay, add: { 'types.x': { nonsense: true } } }),
      by,
    );
    expect(broken.ok).toBe(false);
    expect(projects()).toEqual(p0);
    expect(templates()).toEqual(t0);
  });

  it('round trip: the exported effective file re-imports to an equal file (on another instance)', async () => {
    const a = await world();
    const made = importProjectFile(a.deps, stringify(overlay), a.by, 'A');
    if (!made.ok) throw new Error('import failed');
    const out = effectiveDraftFile(a.open(made.key), controlTemplateSource(a.control));
    if (!out.ok) throw new Error('export failed');
    const text = stringify(out.file);
    const b = await world();
    b.control.prepare('DELETE FROM templates WHERE key = ?').run('baumkataster');
    const again = importProjectFile(b.deps, text, b.by, 'B');
    if (!again.ok) throw new Error(JSON.stringify(again.problems));
    const back = effectiveDraftFile(b.open(again.key), controlTemplateSource(b.control));
    expect(back.ok && back.file).toEqual(out.file);
    expect(parse(text)).toEqual(out.file);
  });
});
