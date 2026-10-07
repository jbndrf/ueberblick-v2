import { describe, expect, it } from 'vitest';
import { openControlDb } from '../db/open';
import { CONTROL_MIGRATIONS } from '../db/control-schema';
import { createInstanceStore, type LegalPageInput } from './store';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_S, consentCookie, consentRefusal, readConsent } from './consent';
import { INSTANCE_ERRORS } from './registry';

const NOW = '2026-10-01T08:00:00.000Z';
const store = () => createInstanceStore(openControlDb(':memory:'), { now: () => NOW });
const page = (over: Partial<LegalPageInput> = {}): LegalPageInput => ({
  slug: 'impressum',
  title: 'Impressum',
  body: '<p>Betreiber</p>',
  sortOrder: 0,
  showInConsentFooter: false,
  ...over,
});
const request = (cookie?: string) => new Request('http://x/', cookie ? { headers: { cookie } } : {});

describe('migration', () => {
  it('is the next free control migration and the settings row exists with consent off', () => {
    const ids = CONTROL_MIGRATIONS.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toContain(6);
    expect(store().settings()).toEqual({
      requireConsent: false,
      consentTitle: '',
      consentBody: '',
      acceptLabel: '',
      rejectLabel: '',
    });
  });
});

describe('instance store', () => {
  it('saves and reads the consent settings', () => {
    const s = store();
    const next = {
      requireConsent: true,
      consentTitle: 'Datenschutz',
      consentBody: '<p>Hallo</p>',
      acceptLabel: 'Ja',
      rejectLabel: 'Nein',
    };
    s.saveSettings(next);
    expect(s.settings()).toEqual(next);
  });

  it('keeps legal pages by slug, ordered by sort order then slug; a second save replaces', () => {
    const s = store();
    s.savePage(page({ slug: 'datenschutz', title: 'Datenschutz', sortOrder: 2 }));
    s.savePage(page({ slug: 'impressum', sortOrder: 1, showInConsentFooter: true }));
    s.savePage(page({ slug: 'a-first', title: 'A', sortOrder: 1 }));
    expect(s.pages().map((p) => p.slug)).toEqual(['a-first', 'impressum', 'datenschutz']);
    s.savePage(page({ slug: 'impressum', title: 'Neu', sortOrder: 9 }));
    expect(s.page('impressum')).toMatchObject({ title: 'Neu', sortOrder: 9, updatedAt: NOW });
    expect(s.pages()).toHaveLength(3);
  });

  it('lists the consent footer pages only, and removes a page', () => {
    const s = store();
    s.savePage(page({ showInConsentFooter: true }));
    s.savePage(page({ slug: 'x', title: 'X' }));
    expect(s.footerPages().map((p) => p.slug)).toEqual(['impressum']);
    expect(s.removePage('x')).toBe(true);
    expect(s.removePage('x')).toBe(false);
    expect(s.page('x')).toBeUndefined();
  });

  it('rejects a slug outside a-z, 0-9 and dash (the /legal/<slug> path)', () => {
    const s = store();
    for (const slug of ['', 'Impressum', 'a b', '../x', 'a/b', 'x'.repeat(101)])
      expect(() => s.savePage(page({ slug }))).toThrow();
  });
});

describe('consent gate', () => {
  it('reads the decision from the cookie', () => {
    expect(readConsent(request())).toBeUndefined();
    expect(readConsent(request(`${CONSENT_COOKIE}=accepted`))).toBe('accepted');
    expect(readConsent(request(`a=b; ${CONSENT_COOKIE}=rejected`))).toBe('rejected');
    expect(readConsent(request(`${CONSENT_COOKIE}=whatever`))).toBeUndefined();
  });

  it('accepting sets a cookie for one year, as v3', () => {
    const c = consentCookie('accepted', { secure: true });
    expect(c).toContain(`${CONSENT_COOKIE}=accepted`);
    expect(c).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
    expect(CONSENT_MAX_AGE_S).toBe(31_536_000);
    expect(c).toContain('Secure');
    expect(consentCookie('rejected', { secure: false })).not.toContain('Secure');
  });

  it('refuses without the cookie only when consent is on, with the registry code', async () => {
    const s = store();
    expect(consentRefusal(s, request())).toBeNull();
    s.saveSettings({ ...s.settings(), requireConsent: true });
    const refused = consentRefusal(s, request());
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toEqual({ code: 'consent_required' });
    expect(INSTANCE_ERRORS.has('consent_required')).toBe(true);
    expect(consentRefusal(s, request(`${CONSENT_COOKIE}=rejected`))?.status).toBe(403);
    expect(consentRefusal(s, request(`${CONSENT_COOKIE}=accepted`))).toBeNull();
  });
});

describe('create-only and rename', () => {
  it('createPage never overwrites: a taken slug returns undefined and keeps the page', () => {
    const s = store();
    expect(s.createPage(page())?.title).toBe('Impressum');
    expect(s.createPage(page({ title: 'Anders' }))).toBeUndefined();
    expect(s.page('impressum')?.title).toBe('Impressum');
    expect(() => s.createPage(page({ slug: 'Bad Slug' }))).toThrow();
  });

  it('renamePage moves and saves the page in one step; missing and taken change nothing', () => {
    const s = store();
    s.savePage(page());
    s.savePage(page({ slug: 'datenschutz', title: 'DS' }));
    expect(s.renamePage('impressum', page({ slug: 'legal', title: 'Legal' }))).toMatchObject({
      status: 'renamed',
      page: { slug: 'legal', title: 'Legal' },
    });
    expect(s.page('impressum')).toBeUndefined();
    expect(s.renamePage('legal', page({ slug: 'datenschutz' }))).toEqual({ status: 'taken' });
    expect(s.page('legal')?.title).toBe('Legal');
    expect(s.page('datenschutz')?.title).toBe('DS');
    expect(s.renamePage('nope', page({ slug: 'x' }))).toEqual({ status: 'missing' });
    expect(s.renamePage('legal', page({ slug: 'legal', title: 'Same' })).status).toBe('renamed');
    expect(s.page('legal')?.title).toBe('Same');
  });
});
