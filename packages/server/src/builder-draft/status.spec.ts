import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { deploy } from '../deploy';
import { openControlDb, openProjectDb } from '../db/open';
import { importParticipant } from '../http/participants/roster';
import { controlTemplateSource, publishTemplate } from '../templates';
import { createDraftStore, draftStatus, ensureDraft, seedDraft } from './index';

const golden = <T>(rel: string): T =>
  embedGoldenRefs(
    parse(
      readFileSync(fileURLToPath(new URL(`../../../../fixtures/golden/${rel}`, import.meta.url)), 'utf8'),
    ),
  ) as T;
const clock = { now: () => '2026-10-01T08:00:00Z' };

function world() {
  const control = openControlDb(':memory:');
  publishTemplate(control, golden<TemplateFile>('templates/baumkataster/1.0.0.yaml'), clock);
  const templates = controlTemplateSource(control);
  const db = openProjectDb(':memory:', 'demo');
  const overlay = golden<OverlayFile>('projects/musterstadt-baeume.yaml');
  const status = () => draftStatus(db, { clock, templates });
  return { db, templates, overlay, status };
}

describe('draftStatus (E-13): dirty, neverPublished, problems', () => {
  it('a project with nothing deployed and no draft is never published and has nothing to publish', () => {
    const { status } = world();
    expect(status()).toEqual({ dirty: false, neverPublished: true, problems: 0, revision: null, type: null });
  });

  it('a fresh project from a template (WP-309): never published, the seeded draft is waiting to go live', () => {
    const { db, overlay, status } = world();
    seedDraft(db, {
      template: 'baumkataster',
      templateVersion: '1.0.0',
      overlay: stringify(overlay),
      by: 'admin-1',
      at: clock.now(),
    });
    expect(status()).toMatchObject({ dirty: true, neverPublished: true, problems: 0, revision: 1 });
  });

  it('publishing deploys version 1 and the draft is clean', () => {
    const { db, templates, overlay, status } = world();
    seedDraft(db, {
      template: 'baumkataster',
      templateVersion: '1.0.0',
      overlay: stringify(overlay),
      by: 'admin-1',
      at: clock.now(),
    });
    expect(deploy(db, overlay, 'admin-1', { clock, templates }).ok).toBe(true);
    expect(status()).toMatchObject({ dirty: false, neverPublished: false, problems: 0 });
  });

  it('editing the draft makes it dirty; saving the deployed text back makes it clean again', () => {
    const { db, templates, overlay, status } = world();
    deploy(db, overlay, 'admin-1', { clock, templates });
    const draft = ensureDraft(db, clock, 'admin-1');
    if (!draft.ok) throw new Error('no draft');
    expect(status().dirty).toBe(false);
    const edited: OverlayFile = { ...overlay, inputs: { ...overlay.inputs, kontrollintervall_monate: 12 } };
    createDraftStore(db).putIf(1, stringify(edited), 'admin-1', clock.now());
    expect(status()).toMatchObject({ dirty: true, neverPublished: false, revision: 2 });
    createDraftStore(db).putIf(2, stringify(overlay), 'admin-1', clock.now());
    expect(status().dirty).toBe(false);
  });

  it('a draft holding an automatic action without a timing (edge) reads as dirty without problems (WP-438: was a 500)', () => {
    const { db, templates, overlay, status } = world();
    deploy(db, overlay, 'admin-1', { clock, templates });
    ensureDraft(db, clock, 'admin-1');
    const edited = {
      ...overlay,
      add: {
        ...overlay.add,
        'tasks.wenn_aufgabe': {
          label: { de: 'Wenn' },
          on: 'baum',
          when: "actor.kind == 'system'",
          auto: { wenn_regel: { label: { de: 'Wenn' }, when: 'self.geometrie != null' } },
        },
      },
    };
    createDraftStore(db).putIf(1, stringify(edited), 'admin-1', clock.now());
    expect(status()).toMatchObject({ dirty: true, neverPublished: false, problems: 0 });
  });

  it('a draft that does not parse counts a problem', () => {
    const { db, templates, overlay, status } = world();
    deploy(db, overlay, 'admin-1', { clock, templates });
    ensureDraft(db, clock, 'admin-1');
    createDraftStore(db).putIf(1, 'extends: [unclosed', 'admin-1', clock.now());
    expect(status()).toMatchObject({ dirty: true, neverPublished: false });
    expect(status().problems).toBeGreaterThan(0);
  });

  it('names the Objektart of the first problem so the bar can link to its builder', () => {
    const { db, templates, overlay, status } = world();
    deploy(db, overlay, 'admin-1', { clock, templates });
    ensureDraft(db, clock, 'admin-1');
    const broken = {
      ...overlay,
      add: { ...overlay.add, 'types.baum.properties.x': { type: 'reference', to: 'gibtsnicht' } },
    };
    createDraftStore(db).putIf(1, stringify(broken), 'admin-1', clock.now());
    const s = status();
    expect(s.problems).toBeGreaterThan(0);
    expect(s.type).toBe('baum');
  });

  it('participants changes never mark the draft dirty (Q13)', () => {
    const { db, templates, overlay, status } = world();
    deploy(db, overlay, 'admin-1', { clock, templates });
    ensureDraft(db, clock, 'admin-1');
    const before = status();
    expect(importParticipant({ db, now: () => new Date(clock.now()) }, { id: 'anna', roles: [] })).toEqual({
      ok: true,
    });
    expect(status()).toEqual(before);
    expect(before.dirty).toBe(false);
  });
});
