// WP-941: the public side of the local CA: the certificate to download, the iOS profile, the QR code of the page.
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTlsMaterial } from '../../../../../../scripts/tls/cert.mjs';
import { caDer, mobileconfig, publicCa, qrSvg, setupPageUrl } from './ca';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const dataDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ca-spec-'));
  dirs.push(d);
  return d;
};

describe('publicCa', () => {
  it('is null while there is no CA (proxy mode, or the front has not started)', () => {
    expect(publicCa(dataDir())).toBeNull();
  });

  it('reads the CA certificate and never anything from the key', () => {
    const dir = dataDir();
    loadTlsMaterial({ dir: join(dir, 'tls'), hosts: ['10.0.0.5'] });
    const ca = publicCa(dir);
    expect(ca?.pem).toBe(readFileSync(join(dir, 'tls', 'ca.crt'), 'utf8'));
    expect(ca?.pem).toContain('BEGIN CERTIFICATE');
    expect(ca?.pem).not.toContain('PRIVATE');
    expect(JSON.stringify(ca)).not.toContain(
      readFileSync(join(dir, 'tls', 'ca.key'), 'utf8').split('\n')[1] ?? 'x',
    );
  });

  it('refuses a file that is not a CA certificate (nothing else under tls/ is ever served)', () => {
    const dir = dataDir();
    loadTlsMaterial({ dir: join(dir, 'tls'), hosts: ['10.0.0.5'] });
    // the server certificate is not a CA
    expect(publicCa(dir, 'server.crt')).toBeNull();
  });
});

describe('mobileconfig', () => {
  it('wraps the DER certificate in a root-certificate profile', () => {
    const dir = dataDir();
    loadTlsMaterial({ dir: join(dir, 'tls'), hosts: ['10.0.0.5'] });
    const ca = publicCa(dir);
    if (ca === null) throw new Error('no CA');
    const xml = mobileconfig(ca.pem);
    expect(xml).toContain('<string>com.apple.security.root</string>');
    expect(xml).toContain(caDer(ca.pem).toString('base64'));
    expect(new X509Certificate(caDer(ca.pem)).ca).toBe(true);
    expect(xml).toMatch(/<key>PayloadUUID<\/key>\s*<string>[0-9A-F-]{36}<\/string>/);
    expect(mobileconfig(ca.pem)).toBe(xml); // stable for the same CA, so a re-download does not install a second profile
  });
});

describe('the page address and its QR code', () => {
  it('points to /setup/zertifikat on the public address', () => {
    expect(setupPageUrl('https://192.168.1.20:8443')).toBe('https://192.168.1.20:8443/setup/zertifikat');
  });

  it('is an inline SVG with no external reference', () => {
    const svg = qrSvg('https://192.168.1.20:8443/setup/zertifikat');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toContain('<script');
  });
});
