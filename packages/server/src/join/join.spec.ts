// WP-639: self-join links, the guest join, and the expiry of guests after 90 days without activity (fake clock).
import { describe, expect, it } from 'vitest';
import { createAuth } from '../auth/service';
import { participantRolesOf } from '../auth/participant-roles';
import { openControlDb, openProjectDb } from '../db/open';
import { listRoster } from '../http/participants/service';
import { expireGuests } from '../timers/guest-expiry';
import { isJoinable, joinAsGuest } from './guest';
import { getSelfJoin, resolveSlug, setSelfJoin } from './links';

function world() {
  const control = openControlDb(':memory:');
  const db = openProjectDb(':memory:', 'demo');
  let t = Date.UTC(2026, 0, 1);
  const now = () => new Date(t);
  control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('id-demo', 'demo', 'Demo', now().toISOString());
  const auth = createAuth({ control, now, participantRoles: (_p, id) => participantRolesOf(db, id) });
  const deps = { control, projectDb: () => db, auth, now };
  const guests = () => db.prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n ?? 0;
  return { control, db, auth, deps, now, guests, advance: (ms: number) => (t += ms) };
}
const DAY = 86_400_000;

describe('self-join links', () => {
  it('switches a link on with a chosen slug and resolves only while enabled', () => {
    const w = world();
    const r = setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'maengel-nord' });
    expect(r).toEqual({ ok: true, selfJoin: { role: 'melder', slug: 'maengel-nord', enabled: true } });
    expect(resolveSlug(w.control, 'maengel-nord')).toEqual({
      projectId: 'id-demo',
      projectKey: 'demo',
      role: 'melder',
    });
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: false });
    expect(resolveSlug(w.control, 'maengel-nord')).toBeUndefined();
    expect(getSelfJoin(w.control, 'id-demo', 'melder')?.slug).toBe('maengel-nord');
  });

  it('generates a slug when none is given, and keeps it on later changes', () => {
    const w = world();
    const r = setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true });
    if (!r.ok) throw new Error(r.code);
    expect(r.selfJoin.slug).toMatch(/^[a-f0-9]{10}$/);
    const again = setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true });
    expect(again.ok && again.selfJoin.slug).toBe(r.selfJoin.slug);
  });

  it('refuses a malformed slug, a malformed role and a slug another role already uses', () => {
    const w = world();
    expect(setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'A b' })).toEqual({
      ok: false,
      code: 'slug_invalid',
    });
    expect(setSelfJoin(w.deps, 'id-demo', 'Bad Role', { enabled: true })).toEqual({
      ok: false,
      code: 'role_invalid',
    });
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'eins' });
    expect(setSelfJoin(w.deps, 'id-demo', 'andere', { enabled: true, slug: 'eins' })).toEqual({
      ok: false,
      code: 'slug_taken',
    });
  });

  it('a changed slug ends the old link at once', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'alt' });
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'neu' });
    expect(resolveSlug(w.control, 'alt')).toBeUndefined();
    expect(resolveSlug(w.control, 'neu')?.role).toBe('melder');
  });
});

describe('joining as a guest', () => {
  it('looking at the link (isJoinable) creates nothing; unknown and disabled slugs are link_unknown', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    setSelfJoin(w.deps, 'id-demo', 'zu', { enabled: false, slug: 'geschlossen' });
    expect(isJoinable(w.control, 'offen')).toBe(true);
    expect(isJoinable(w.control, 'geschlossen')).toBe(false);
    expect(w.guests()).toBe(0);
    expect(joinAsGuest(w.deps, 'nichts', null)).toEqual({ ok: false, code: 'link_unknown' });
    expect(joinAsGuest(w.deps, 'geschlossen', null)).toEqual({ ok: false, code: 'link_unknown' });
    expect(w.guests()).toBe(0);
  });

  it('WP-1074: stores the name the guest typed (cleaned); empty or markup-only gives Gast', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    const nameOf = (typed: unknown): string | undefined => {
      const r = joinAsGuest(w.deps, 'offen', null, typed);
      if (!r.ok || r.kind !== 'created') throw new Error('not created');
      return w.db.prepare<{ name: string }>('SELECT name FROM participants WHERE id = ?').get(r.participantId)
        ?.name;
    };
    expect(nameOf('  Erika   Muster ')).toBe('Erika Muster');
    expect(nameOf('<b>Max</b><script>x</script>')).toBe('Max x');
    expect(nameOf('')).toBe('Gast');
    expect(nameOf('<>')).toBe('Gast');
    expect(nameOf(undefined)).toBe('Gast');
    expect(Array.from(nameOf('ä'.repeat(100)) ?? '')).toHaveLength(40);
  });

  it('creates a guest named Gast with the link role, no e-mail, and opens a session for them', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    const r = joinAsGuest(w.deps, 'offen', null);
    if (!r.ok || r.kind !== 'created') throw new Error('not created');
    const row = w.db
      .prepare<{ name: string; roles: string; self_joined: number; created_at: string; attrs: string }>(
        'SELECT name, roles, self_joined, created_at, attrs FROM participants WHERE id = ?',
      )
      .get(r.participantId);
    expect(row?.name).toBe('Gast');
    expect(JSON.parse(row?.roles ?? '[]')).toEqual(['melder']);
    expect(row?.self_joined).toBe(1);
    expect(row?.created_at).toBe(w.now().toISOString());
    expect(JSON.parse(row?.attrs ?? '{}')).toEqual({ created_by: 'system', join_slug: 'offen' });
    const who = w.auth.authenticate(r.session.id);
    expect(who).toMatchObject({
      kind: 'participant',
      id: r.participantId,
      projectId: 'id-demo',
      roles: ['melder'],
    });
    expect(
      listRoster(
        { db: w.db, control: w.control, auth: w.auth, projectId: 'id-demo', now: w.now },
        { guests: true },
      ),
    ).toHaveLength(1);
  });

  it('a device that already holds a session of this project is signed in again, not given a second guest', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    const first = joinAsGuest(w.deps, 'offen', null);
    if (!first.ok || first.kind !== 'created') throw new Error('not created');
    const principal = w.auth.authenticate(first.session.id);
    expect(joinAsGuest(w.deps, 'offen', principal)).toEqual({ ok: true, kind: 'existing' });
    expect(w.guests()).toBe(1);
  });

  it("an admin or a participant of another project does not count as this project's guest", () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    const other = { kind: 'participant', id: 'x', projectId: 'id-other', roles: [] } as const;
    expect(joinAsGuest(w.deps, 'offen', other)).toMatchObject({ ok: true, kind: 'created' });
  });
});

describe('guest expiry', () => {
  const deps = (w: ReturnType<typeof world>) => ({
    db: w.db,
    auth: w.auth,
    projectId: 'id-demo',
    now: w.now,
  });

  it('deactivates a guest who never came back 90 days after joining: the row stays, the session and the token end', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    const r = joinAsGuest(w.deps, 'offen', null);
    if (!r.ok || r.kind !== 'created') throw new Error('not created');
    w.advance(90 * DAY - 1000);
    expect(expireGuests(deps(w))).toBe(0);
    w.advance(1000);
    expect(expireGuests(deps(w))).toBe(1);
    expect(w.auth.authenticate(r.session.id)).toBeNull();
    const row = w.db
      .prepare<{ disabled_at: string | null }>('SELECT disabled_at FROM participants WHERE id = ?')
      .get(r.participantId);
    expect(row?.disabled_at).toBe(w.now().toISOString());
    expect(expireGuests(deps(w))).toBe(0);
  });

  it("never touches a participant an admin added, and counts 90 days from each guest's own joining", () => {
    const w = world();
    w.db
      .prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)')
      .run('anna', 'Anna', '["melder"]');
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    joinAsGuest(w.deps, 'offen', null);
    w.advance(60 * DAY);
    const late = joinAsGuest(w.deps, 'offen', null);
    if (!late.ok || late.kind !== 'created') throw new Error('not created');
    w.advance(31 * DAY);
    expect(expireGuests(deps(w))).toBe(1);
    expect(w.auth.authenticate(late.session.id)).not.toBeNull();
    w.advance(400 * DAY);
    expect(expireGuests(deps(w))).toBe(1);
    const anna = w.db
      .prepare<{ disabled_at: string | null }>("SELECT disabled_at FROM participants WHERE id = 'anna'")
      .get();
    expect(anna?.disabled_at).toBeNull();
  });

  it('keeps a guest who joined over 90 days ago but was active within the last 90 days', () => {
    const w = world();
    setSelfJoin(w.deps, 'id-demo', 'melder', { enabled: true, slug: 'offen' });
    const r = joinAsGuest(w.deps, 'offen', null);
    if (!r.ok || r.kind !== 'created') throw new Error('not created');
    w.advance(80 * DAY);
    expect(w.auth.authenticate(r.session.id)).not.toBeNull(); // activity: the session renews
    w.advance(80 * DAY); // 160 days after joining, 80 after the last use
    expect(expireGuests(deps(w))).toBe(0);
    expect(w.auth.authenticate(r.session.id)).not.toBeNull(); // this use renews again
    w.advance(89 * DAY);
    expect(expireGuests(deps(w))).toBe(0);
    w.advance(2 * DAY); // 91 days since the last use
    expect(expireGuests(deps(w))).toBe(1);
    expect(w.auth.authenticate(r.session.id)).toBeNull();
  });
});
