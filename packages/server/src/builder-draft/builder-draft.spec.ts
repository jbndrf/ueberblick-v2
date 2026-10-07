import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { deploy } from '../deploy';
import { openControlDb, openProjectDb } from '../db/open';
import { controlTemplateSource, publishTemplate } from '../templates';
import { createDraftStore, draftSources, ensureDraft } from './index';
import { embedGoldenRefs } from '@ueberblick/core/testing';

const golden = <T>(rel: string): T =>
  embedGoldenRefs(
    parse(
      readFileSync(fileURLToPath(new URL(`../../../../fixtures/golden/${rel}`, import.meta.url)), 'utf8'),
    ),
  ) as T;
const clock = { now: () => '2026-09-30T08:00:00Z' };

function world() {
  const control = openControlDb(':memory:');
  const template = golden<TemplateFile>('templates/baumkataster/1.0.0.yaml');
  publishTemplate(control, template, clock);
  const templates = controlTemplateSource(control);
  const db = openProjectDb(':memory:', 'demo');
  return { db, templates, template };
}

describe('DraftStore.putIf (compare-and-swap on the revision)', () => {
  const seed = { template: 'baumkataster', templateVersion: '1.0.0', overlay: 'extends: baumkataster@1\n' };

  it('has no draft until one is seeded, and seeding twice keeps the first', () => {
    const { db } = world();
    const store = createDraftStore(db);
    expect(store.get()).toBeUndefined();
    const first = store.seed({ ...seed, by: 'a', at: clock.now() });
    expect(first.revision).toBe(1);
    expect(store.seed({ ...seed, overlay: 'other', by: 'b', at: clock.now() })).toEqual(first);
  });

  it('a put with the current revision stores the overlay and increments the revision', () => {
    const { db } = world();
    const store = createDraftStore(db);
    store.seed({ ...seed, by: 'a', at: clock.now() });
    const r = store.putIf(1, 'edited', 'admin-1', '2026-09-30T09:00:00Z');
    expect(r.ok).toBe(true);
    expect(r.draft).toMatchObject({
      overlay: 'edited',
      revision: 2,
      updatedBy: 'admin-1',
      updatedAt: '2026-09-30T09:00:00Z',
    });
    expect(store.get()).toEqual(r.draft);
  });

  it('a stale revision returns the current draft and changes nothing', () => {
    const { db } = world();
    const store = createDraftStore(db);
    store.seed({ ...seed, by: 'a', at: clock.now() });
    store.putIf(1, 'first', 'a', clock.now());
    const before = store.get();
    const r = store.putIf(1, 'late', 'b', clock.now());
    expect(r.ok).toBe(false);
    expect(r.draft).toEqual(before);
    expect(store.get()).toEqual(before);
  });

  it('a put before any draft exists is refused with no draft written', () => {
    const { db } = world();
    const store = createDraftStore(db);
    expect(store.putIf(1, 'x', 'a', clock.now())).toEqual({ ok: false, draft: undefined });
    expect(store.get()).toBeUndefined();
  });

  it('property: interleaved writers never lose an accepted write and the revision counts the accepted ones', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ writer: fc.integer({ min: 0, max: 2 }), lag: fc.integer({ min: 0, max: 2 }) }), {
          maxLength: 30,
        }),
        (steps) => {
          const store = createDraftStore(openProjectDb(':memory:', 'demo'));
          store.seed({ ...seed, by: 'a', at: clock.now() });
          // each writer holds the revision it last saw; `lag` makes it act on an older one
          const seen = [1, 1, 1];
          let accepted = 0;
          steps.forEach((s, i) => {
            const base = Math.max(1, (seen[s.writer] as number) - s.lag);
            const r = store.putIf(base, `w${s.writer}-${i}`, `w${s.writer}`, clock.now());
            const current = store.get();
            if (r.ok) {
              accepted++;
              expect(r.draft.overlay).toBe(`w${s.writer}-${i}`);
              expect(r.draft.revision).toBe(base + 1);
            } else {
              expect(r.draft).toEqual(current);
              expect(base).not.toBe(current?.revision);
            }
            seen[s.writer] = (current as { revision: number }).revision;
          });
          expect(store.get()?.revision).toBe(1 + accepted);
        },
      ),
    );
  });
});

describe('DraftStore.reset (a new base for the draft, e.g. after a template upgrade)', () => {
  const seed = { template: 'baumkataster', templateVersion: '1.0.0', overlay: 'extends: baumkataster@1\n' };
  const next = { template: 'baumkataster', templateVersion: '2.0.0', overlay: 'extends: baumkataster@2\n' };

  it('replaces template, version and overlay and bumps the revision, so an open editor is refused', () => {
    const store = createDraftStore(openProjectDb(':memory:', 'demo'));
    store.seed({ ...seed, by: 'a', at: clock.now() });
    store.putIf(1, 'edited', 'a', clock.now());
    const r = store.reset({ ...next, by: 'b', at: '2026-10-01T00:00:00Z' });
    expect(r).toMatchObject({ ...next, revision: 3, updatedBy: 'b', updatedAt: '2026-10-01T00:00:00Z' });
    expect(store.get()).toEqual(r);
    expect(store.putIf(2, 'late', 'a', clock.now()).ok).toBe(false); // an editor that still holds revision 2
  });

  it('on a database without a draft it creates the first one', () => {
    const store = createDraftStore(openProjectDb(':memory:', 'demo'));
    expect(store.reset({ ...next, by: 'b', at: clock.now() }).revision).toBe(1);
  });
});

describe('ensureDraft: seeding from the deployed version', () => {
  it('answers no_version while nothing is deployed', () => {
    const { db } = world();
    expect(ensureDraft(db, clock, 'admin-1')).toEqual({ ok: false, code: 'no_version' });
  });

  it('seeds from the deployed overlay and pins the template version', () => {
    const { db, templates } = world();
    const overlay = golden<OverlayFile>('projects/musterstadt-baeume.yaml');
    expect(deploy(db, overlay, 'admin-1', { clock, templates }).ok).toBe(true);
    const r = ensureDraft(db, clock, 'admin-2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft).toMatchObject({
      template: 'baumkataster',
      templateVersion: '1.0.0',
      revision: 1,
      updatedBy: 'admin-2',
    });
    expect(parse(r.draft.overlay)).toEqual(overlay);
    // a second call returns the stored draft, even after a new deploy
    expect(ensureDraft(db, clock, 'admin-3')).toEqual(r);
  });

  it('seeds an empty overlay on the template major when a plain template was deployed', () => {
    const { db, template } = world();
    expect(deploy(db, template, 'admin-1', { clock }).ok).toBe(true);
    const r = ensureDraft(db, clock, 'admin-1');
    expect(r.ok && parse(r.draft.overlay)).toEqual({ schema: 'ueberblick/1', extends: 'baumkataster@1' });
  });

  it('draftSources gives the template and overlay source the builder opens', () => {
    const { db, templates, template } = world();
    deploy(db, template, 'admin-1', { clock });
    const r = ensureDraft(db, clock, 'admin-1');
    if (!r.ok) throw new Error('seed failed');
    const s = draftSources(r.draft, templates);
    expect(s && parse(s.templateSrc)).toEqual(template);
    expect(s?.overlaySrc).toBe(r.draft.overlay);
  });
});
