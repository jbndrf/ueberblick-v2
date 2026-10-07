// WP-941: the self-generated local CA and server certificate of HTTPS_MODE=direct.
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTlsMaterial, sanOf } from './cert.mjs';

const dirs: string[] = [];
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tls-spec-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const cert = (file: string): X509Certificate => new X509Certificate(readFileSync(file));
const FILES = ['ca.crt', 'ca.key', 'server.crt', 'server.key'];

describe('loadTlsMaterial', () => {
  it('creates a CA and a server certificate whose SANs equal LOCAL_HOSTS', () => {
    const dir = fresh();
    const hosts = ['192.168.1.20', 'ueberblick.local', '::1'];
    const m = loadTlsMaterial({ dir, hosts });
    expect(m.created).toEqual({ ca: true, server: true });
    const ca = cert(join(dir, 'ca.crt'));
    const server = cert(join(dir, 'server.crt'));
    expect(ca.ca).toBe(true);
    expect(server.ca).toBe(false);
    expect(server.checkIssued(ca)).toBe(true);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(sanOf(server).sort()).toEqual([...hosts].sort());
    expect(server.checkIP('192.168.1.20')).toBeDefined();
    expect(server.checkHost('ueberblick.local')).toBe('ueberblick.local');
    expect(server.checkIP('::1')).toBeDefined();
    expect(server.checkIP('192.168.1.21')).toBeUndefined();
    // about ten years for the CA; the server certificate stays within the 398 days current iOS and Chrome allow
    const years = (ca.validToDate.getTime() - ca.validFromDate.getTime()) / 31_557_600_000;
    expect(years).toBeGreaterThan(9.9);
    const days = (server.validToDate.getTime() - server.validFromDate.getTime()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(398);
    expect(m.server.certPem).toContain('BEGIN CERTIFICATE');
  });

  it('uses a fixed subject CN, so a host longer than 64 characters cannot make an invalid certificate', () => {
    const dir = fresh();
    const long = 'a'.repeat(80) + '.example.org';
    loadTlsMaterial({ dir, hosts: [long, '10.0.0.5'] });
    const server = cert(join(dir, 'server.crt'));
    expect(server.subject).toContain('CN=Ueberblick');
    expect(server.subject).not.toContain(long);
    expect(sanOf(server).sort()).toEqual(['10.0.0.5', long].sort());
  });

  it('keeps the keys private on disk and never puts the CA key in the result', () => {
    const dir = fresh();
    const m = loadTlsMaterial({ dir, hosts: ['10.0.0.5'] });
    expect(statSync(join(dir, 'ca.key')).mode & 0o077).toBe(0);
    expect(statSync(join(dir, 'server.key')).mode & 0o077).toBe(0);
    expect(Object.keys(m)).not.toContain('caKeyPem');
    expect(JSON.stringify(m)).not.toContain(readFileSync(join(dir, 'ca.key'), 'utf8').split('\n')[1] ?? 'x');
  });

  it('reuses both on the second start', () => {
    const dir = fresh();
    loadTlsMaterial({ dir, hosts: ['10.0.0.5'] });
    const read = (): string[] => FILES.map((f) => readFileSync(join(dir, f), 'utf8'));
    const before = read();
    const again = loadTlsMaterial({ dir, hosts: ['10.0.0.5'] });
    expect(again.created).toEqual({ ca: false, server: false });
    expect(read()).toEqual(before);
  });

  it('reissues the server certificate only when LOCAL_HOSTS changes (added or removed host)', () => {
    const dir = fresh();
    loadTlsMaterial({ dir, hosts: ['10.0.0.5'] });
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
    const first = readFileSync(join(dir, 'server.crt'), 'utf8');
    const added = loadTlsMaterial({ dir, hosts: ['10.0.0.5', 'box.local'] });
    expect(added.created).toEqual({ ca: false, server: true });
    expect(readFileSync(join(dir, 'ca.crt'), 'utf8')).toBe(ca);
    expect(readFileSync(join(dir, 'server.crt'), 'utf8')).not.toBe(first);
    expect(sanOf(cert(join(dir, 'server.crt'))).sort()).toEqual(['10.0.0.5', 'box.local']);
    expect(cert(join(dir, 'server.crt')).verify(cert(join(dir, 'ca.crt')).publicKey)).toBe(true);
    const removed = loadTlsMaterial({ dir, hosts: ['box.local'] });
    expect(removed.created).toEqual({ ca: false, server: true });
    expect(sanOf(cert(join(dir, 'server.crt')))).toEqual(['box.local']);
  });

  it('reissues the server certificate when nearly expired, and both when the CA is unreadable', () => {
    const dir = fresh();
    loadTlsMaterial({ dir, hosts: ['10.0.0.5'] });
    // a 397-day certificate made now has 17 days left at now + 380 days, inside the 30-day window
    const later = new Date(Date.now() + 380 * 86_400_000);
    expect(loadTlsMaterial({ dir, hosts: ['10.0.0.5'], now: later }).created).toEqual({
      ca: false,
      server: true,
    });
    writeFileSync(join(dir, 'ca.crt'), 'broken');
    expect(loadTlsMaterial({ dir, hosts: ['10.0.0.5'] }).created).toEqual({ ca: true, server: true });
  });

  it('refuses an empty host list', () => {
    expect(() => loadTlsMaterial({ dir: fresh(), hosts: [] })).toThrow(/LOCAL_HOSTS/);
  });
});
