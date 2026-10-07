import { describe, expect, it } from 'vitest';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { openControlDb, openProjectDb } from '../db/open';
import { deploy } from '../deploy';
import { controlTemplateSource, publishTemplate } from './index';

const clock = { now: () => '2026-09-29T10:00:00Z' };

const tpl = (version: string, label = 'Baum'): TemplateFile => ({
  schema: 'ueberblick/1',
  template: { key: 'demo', version },
  types: { baum: { label, properties: { art: { type: 'text' } } } },
  tasks: { melden: { label: 'Melden', on: 'baum', form: { art: {} } } },
});
const overlay: OverlayFile = { schema: 'ueberblick/1', extends: 'demo@1' };

describe('control.db template source', () => {
  it('publishes a template and resolves extends by major to the highest published version', () => {
    const db = openControlDb(':memory:');
    expect(publishTemplate(db, tpl('1.0.0'), clock)).toEqual({ ok: true, created: true });
    publishTemplate(db, tpl('1.2.0'), clock);
    publishTemplate(db, tpl('1.10.0'), clock);
    publishTemplate(db, tpl('2.0.0'), clock);
    const src = controlTemplateSource(db);
    expect(src.resolve('demo@1')?.template.version).toBe('1.10.0');
    expect(src.resolve('demo@2')?.template.version).toBe('2.0.0');
    expect(src.resolve('demo@1.2.0')?.template.version).toBe('1.2.0');
    expect(src.resolve('demo@3')).toBeUndefined();
    expect(src.resolve('other@1')).toBeUndefined();
  });

  it('is idempotent for identical content and refuses a changed re-publish (immutable)', () => {
    const db = openControlDb(':memory:');
    publishTemplate(db, tpl('1.0.0'), clock);
    expect(publishTemplate(db, tpl('1.0.0'), clock)).toEqual({ ok: true, created: false });
    const r = publishTemplate(db, tpl('1.0.0', 'Anders'), clock);
    expect(r.ok).toBe(false);
  });

  it('does not publish a template that does not compile', () => {
    const db = openControlDb(':memory:');
    const bad = structuredClone(tpl('1.0.0'));
    Object.assign(bad.tasks?.['melden'] ?? {}, { on: 'nope' });
    const r = publishTemplate(db, bad, clock);
    expect(r.ok).toBe(false);
    expect(db.prepare<{ n: number }>('SELECT count(*) AS n FROM templates').get()?.n).toBe(0);
  });

  it('deploys an overlay against a published template (WP-112 port)', () => {
    const control = openControlDb(':memory:');
    publishTemplate(control, tpl('1.0.0'), clock);
    const project = openProjectDb(':memory:', 'a');
    const r = deploy(project, overlay, 'admin:1', { clock, templates: controlTemplateSource(control) });
    expect(r.ok).toBe(true);
    const row = project
      .prepare<{ template: string; template_version: string }>(
        'SELECT template, template_version FROM config_versions',
      )
      .get();
    expect([row?.template, row?.template_version]).toEqual(['demo', '1.0.0']);
  });
});
