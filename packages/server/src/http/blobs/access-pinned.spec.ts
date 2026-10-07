// WP-317 (WP-316 decision 1): a blob is judged under the permissions of its feature's own version.
import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Key, TemplateFile } from '@ueberblick/core';
import { createConfigResolver, createVersionCache } from '../../store/run/config-for';
import { actor, build, fid, setup } from '../../store/run/testkit';
import { createBlobAccess } from './access';

const SHA_PINNED = 'a'.repeat(64);
const SHA_FLOATING = 'b'.repeat(64);

/** `see` of `meldung`: v1 lets `alt` see it, v2 lets `neu`; v2 also hides `foto` from `alt`-like readers differently. */
const template = (version: 1 | 2, see: string[]): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'blob_pin', version: `${version}.0.0` },
    roles: { melder: { label: 'Melder' }, alt: { label: 'Alt' }, neu: { label: 'Neu' } },
    types: {
      meldung: {
        label: 'Meldung',
        permissions: { see, create: '$all', write: '$all' },
        properties: { foto: { type: 'file' } },
      },
    },
    tasks: { melden: { label: 'Melden', on: '$map', creates: 'meldung', form: { foto: {} } } },
  }) as unknown as TemplateFile;

const v1 = build(template(1, ['alt']));
const v2 = build(template(2, ['neu']));

function world() {
  const c = setup({ config: v1, version: 1, configs: new Map([[2, v2]]), deployed: 2 });
  for (const sha of [SHA_PINNED, SHA_FLOATING])
    c.db
      .prepare("INSERT INTO blobs (sha256, mime, bytes, created_at) VALUES (?, 'image/jpeg', 3, 'x')")
      .run(sha);
  const mia = actor('participant', 'mia', ['melder']);
  for (const sha of [SHA_PINNED, SHA_FLOATING])
    c.db
      .prepare(
        "INSERT INTO blob_uploads (sha256, actor, actor_kind, created_at) VALUES (?, 'mia', 'participant', 'x')",
      )
      .run(sha);
  const create = (id: FeatureId, sha: string) => {
    const r = c.store.submit(
      c.run('melden', mia, { foto: [{ sha256: sha, name: 'a.jpg', mime: 'image/jpeg' }] }, id, {
        configVersion: 2,
      }),
    );
    expect(r.outcome).toBe('accepted');
  };
  create(fid(1), SHA_PINNED);
  create(fid(2), SHA_FLOATING);
  c.db.prepare('UPDATE features SET pinned_version = 1 WHERE id = ?').run(fid(1));
  const versions = createConfigResolver(
    c.db,
    createVersionCache((v) => (v === 1 ? v1 : v === 2 ? v2 : undefined)),
  );
  const access = createBlobAccess({
    db: c.db,
    clock: c.deps.clock,
    deployed: () => 2,
    versions,
  });
  const as = (role: string): Actor => actor('participant', `p_${role}`, [role]);
  return { access, as };
}

describe('blob access under the feature version', () => {
  it('allowed under the pinned version but not under the deployed one: the pinned feature blob is readable', () => {
    const w = world();
    expect(w.access.allowed(w.as('alt'), SHA_PINNED)).toBe(true);
  });

  it('allowed only under the deployed version: the pinned feature blob stays closed, the floating one opens', () => {
    const w = world();
    expect(w.access.allowed(w.as('neu'), SHA_PINNED)).toBe(false);
    expect(w.access.allowed(w.as('neu'), SHA_FLOATING)).toBe(true);
  });

  it('allowed under the old version only: the floating feature blob is closed (it follows the deployed version)', () => {
    const w = world();
    expect(w.access.allowed(w.as('alt'), SHA_FLOATING)).toBe(false);
  });

  it('a role that neither version lets see the file stays out', () => {
    const w = world();
    expect(w.access.allowed(actor('participant', 'x', ['melder' as Key]), SHA_PINNED)).toBe(false);
  });
});
