import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import {
  controlCatalog,
  controlTemplateSource,
  createAuth,
  createProjectFromTemplate,
  deploy,
  effectiveDeployedFile,
  listTemplates,
  openControlDb,
  openProjectDb,
  publishTemplate,
  publishTemplateVersion,
  templateFromProject,
  validateNewProject,
} from '@ueberblick/server';

// WP-383: "Als Vorlage veröffentlichen" over real databases: the published version is what "Projekt erstellen" offers.
const golden = <T>(rel: string): T =>
  embedGoldenRefs(
    parse(
      readFileSync(
        fileURLToPath(new URL(`../../../../../../fixtures/golden/${rel}`, import.meta.url)),
        'utf8',
      ),
    ),
  ) as T;
const clock = { now: () => '2026-10-02T08:00:00Z' };

async function deployedProject() {
  const control = openControlDb(':memory:');
  const auth = createAuth({ control, now: () => new Date(0), participantRoles: () => [] });
  const by = await auth.createAdmin('a@example.org', 'correct horse battery');
  publishTemplate(control, golden<TemplateFile>('templates/baumkataster/1.0.0.yaml'), clock);
  const db = openProjectDb(':memory:', 'muster');
  const overlay = golden<OverlayFile>('projects/musterstadt-baeume.yaml');
  expect(deploy(db, overlay, by, { clock, templates: controlTemplateSource(control) }).ok).toBe(true);
  return { control, db, by };
}

describe('publish a project as a template (WP-383)', () => {
  it('creates a template version that "Projekt erstellen" then offers and creates from', async () => {
    const { control, db, by } = await deployedProject();
    const effective = effectiveDeployedFile(db);
    if (!effective.ok) throw new Error('no deployed file');
    const file = templateFromProject(effective.file, {
      key: 'meine_baeume',
      version: '1.0.0',
      label: { de: 'Meine Bäume', en: 'Meine Bäume' },
    });
    expect(publishTemplateVersion(control, controlCatalog(control), clock, stringify(file))).toEqual({
      ok: true,
      created: true,
    });
    expect(listTemplates(control, clock).map((t) => `${t.key}@${t.version}`)).toContain('meine_baeume@1.0.0');
    const input = { name: 'Neu', description: '', template: 'meine_baeume@1' };
    expect(validateNewProject(control, input, clock)).toEqual([]);
    const made = createProjectFromTemplate(control, (k) => openProjectDb(':memory:', k), input, by, clock);
    expect(made.key).toBe('neu');
  });

  it('the same content again is a no-op, a higher version is accepted, other content under a published version is refused', async () => {
    const { control, db } = await deployedProject();
    const effective = effectiveDeployedFile(db);
    if (!effective.ok) throw new Error('no deployed file');
    const make = (version: string) =>
      stringify(templateFromProject(effective.file, { key: 'meine_baeume', version }));
    const catalog = () => controlCatalog(control);
    expect(publishTemplateVersion(control, catalog(), clock, make('1.0.0')).ok).toBe(true);
    expect(publishTemplateVersion(control, catalog(), clock, make('1.0.0'))).toMatchObject({
      ok: true,
      created: false,
    });
    expect(publishTemplateVersion(control, catalog(), clock, make('1.1.0'))).toEqual({
      ok: true,
      created: true,
    });
    const changed = { ...effective.file, tools: { x: {} } };
    const other = stringify(templateFromProject(changed, { key: 'meine_baeume', version: '1.0.0' }));
    expect(publishTemplateVersion(control, catalog(), clock, other)).toMatchObject({ ok: false });
  });
});
