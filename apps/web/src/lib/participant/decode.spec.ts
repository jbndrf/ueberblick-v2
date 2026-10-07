import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_CACHE_FORMAT,
  decodeBootstrap,
  decodeCachedIdentity,
  decodeCompiled,
  identityOf,
} from './decode';

const compiled = { format: 1, file: {}, hash: 'h', expressions: [] };
const good = {
  project: { key: 'p', displayName: 'Projekt', icon: null, preview: false },
  participant: { id: 'a', name: 'Anna', roles: ['r'], email: null, phone: null },
  infoPages: [{ key: 'hilfe', title: 'Hilfe', content: { de: '<p>x</p>' } }],
  legalPages: [{ slug: 'impressum', title: 'Impressum', body: '<p>x</p>' }],
  version: 3,
  session: { expiresAt: '2027-01-01T00:00:00.000Z' },
  login: { token: 'AAAA', link: 'http://x/login?token=AAAA' },
  compiled,
};

describe('decodeBootstrap', () => {
  it('accepts a well-formed bootstrap', () => {
    expect(decodeBootstrap(good)).toEqual({ ok: true, bootstrap: good });
  });

  it.each([
    ['not an object', 'x'],
    ['no project', { ...good, project: undefined }],
    ['project as a bare key', { ...good, project: 'p' }],
    ['no display name', { ...good, project: { key: 'p', icon: null } }],
    [
      'icon neither sha nor null',
      { ...good, project: { key: 'p', displayName: 'P', icon: 3, preview: false } },
    ],
    ['no preview flag', { ...good, project: { key: 'p', displayName: 'P', icon: null } }],
    [
      'preview not a boolean',
      { ...good, project: { key: 'p', displayName: 'P', icon: null, preview: 'yes' } },
    ],
    ['no participant name', { ...good, participant: { id: 'a', roles: [] } }],
    ['no session', { ...good, session: undefined }],
    ['expiry not an instant', { ...good, session: { expiresAt: 'soon' } }],
    ['login without link', { ...good, login: { token: 't' } }],
    ['no login field', { ...good, login: undefined }],
    ['roles not strings', { ...good, participant: { id: 'a', name: 'A', roles: [1] } }],
    ['e-mail neither text nor null', { ...good, participant: { ...good.participant, email: 3 } }],
    ['no phone', { ...good, participant: { id: 'a', name: 'A', roles: [], email: null } }],
    ['no info pages', { ...good, infoPages: undefined }],
    ['an info page without content', { ...good, infoPages: [{ key: 'k', title: 't' }] }],
    ['no legal pages', { ...good, legalPages: undefined }],
    ['a legal page without body', { ...good, legalPages: [{ slug: 's', title: 't' }] }],
    ['version not a number', { ...good, version: '3' }],
    ['no compiled config', { ...good, compiled: undefined }],
    ['compiled without expressions', { ...good, compiled: { format: 1, file: {}, hash: 'h' } }],
  ])('refuses %s with a reason', (_name, body) => {
    const r = decodeBootstrap(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe('decodeBootstrap, optional parts', () => {
  it('accepts a project icon and no login', () => {
    const b = { ...good, project: { key: 'p', displayName: 'P', icon: 'ab12', preview: true }, login: null };
    expect(decodeBootstrap(b)).toEqual({ ok: true, bootstrap: b });
  });
});

describe('decodeBootstrap, access (WP-798)', () => {
  it('accepts a text access or none, and refuses another type', () => {
    expect(decodeBootstrap({ ...good, access: 'a1' }).ok).toBe(true);
    expect(decodeBootstrap(good).ok).toBe(true);
    const r = decodeBootstrap({ ...good, access: 7 });
    expect(r.ok).toBe(false);
  });
});

describe('decodeCachedIdentity', () => {
  const identity = identityOf(good);
  it('reads the versioned record it wrote, and refuses another version or shape (no fallback)', () => {
    const text = (o: unknown): string => JSON.stringify(o);
    expect(decodeCachedIdentity(text({ format: BOOTSTRAP_CACHE_FORMAT, identity }))).toEqual(identity);
    expect(decodeCachedIdentity(text({ format: BOOTSTRAP_CACHE_FORMAT + 1, identity }))).toBeUndefined();
    expect(
      decodeCachedIdentity(text({ format: BOOTSTRAP_CACHE_FORMAT, identity: { ...identity, session: {} } })),
    ).toBeUndefined();
    expect(decodeCachedIdentity(text(identity))).toBeUndefined();
    expect(decodeCachedIdentity('not json')).toBeUndefined();
  });
});

describe('cached identity carries e-mail, info pages and legal pages', () => {
  it('round-trips them, and a cache without them (format 1) is refused', () => {
    const identity = identityOf(good);
    const text = JSON.stringify({ format: BOOTSTRAP_CACHE_FORMAT, identity });
    const back = decodeCachedIdentity(text);
    expect(back?.infoPages).toEqual(good.infoPages);
    expect(back?.legalPages).toEqual(good.legalPages);
    const old: Record<string, unknown> = { ...identity };
    delete old['infoPages'];
    delete old['legalPages'];
    expect(
      decodeCachedIdentity(JSON.stringify({ format: BOOTSTRAP_CACHE_FORMAT, identity: old })),
    ).toBeUndefined();
  });
});

describe('decodeCompiled', () => {
  it('returns the compiled shape and throws loudly on a mismatch', () => {
    expect(decodeCompiled(compiled)).toBe(compiled);
    expect(() => decodeCompiled({ format: 1 })).toThrow(/compiled config/);
    expect(() => decodeCompiled(null)).toThrow(/compiled config/);
  });
});

describe('the preview flag survives the device cache (WP-679)', () => {
  it('a preview identity read from the cache is still a preview, so an offline start shows the banner', () => {
    const identity = identityOf({ ...good, project: { ...good.project, preview: true } });
    const back = decodeCachedIdentity(JSON.stringify({ format: BOOTSTRAP_CACHE_FORMAT, identity }));
    expect(back?.project.preview).toBe(true);
  });
});
