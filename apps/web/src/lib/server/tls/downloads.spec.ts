// WP-941: the two downloads and the data of the setup page; nothing but public data leaves.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTlsMaterial } from '../../../../../../scripts/tls/cert.mjs';
import { caCertificateResponse, mobileconfigResponse, setupPageData } from './downloads';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const withCa = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dl-spec-'));
  dirs.push(d);
  loadTlsMaterial({ dir: join(d, 'tls'), hosts: ['10.0.0.5'] });
  return d;
};
const without = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dl-spec-'));
  dirs.push(d);
  return d;
};

describe('downloads', () => {
  it('serves the CA certificate as a .crt file', async () => {
    const res = caCertificateResponse(withCa());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-x509-ca-cert');
    expect(res.headers.get('content-disposition')).toContain('ueberblick-ca.crt');
    const body = await res.text();
    expect(body).toContain('BEGIN CERTIFICATE');
    expect(body).not.toContain('PRIVATE KEY');
  });

  it('serves the iOS profile', async () => {
    const res = mobileconfigResponse(withCa());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-apple-aspen-config');
    expect(await res.text()).toContain('com.apple.security.root');
  });

  it('answers 404 without a CA', () => {
    expect(caCertificateResponse(without()).status).toBe(404);
    expect(mobileconfigResponse(without()).status).toBe(404);
  });
});

describe('setupPageData', () => {
  it('carries the CA fingerprint, the QR of the page and its address', () => {
    const data = setupPageData(withCa(), 'https://10.0.0.5:8443', 'en-US,en;q=0.9');
    expect(data.locale).toBe('en');
    expect(data.ca?.fingerprint).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
    expect(data.pageUrl).toBe('https://10.0.0.5:8443/setup/zertifikat');
    expect(data.qr.startsWith('<svg')).toBe(true);
  });

  it('is German by default and has no CA in proxy mode', () => {
    const data = setupPageData(without(), 'https://ueberblick.example.org', null);
    expect(data.locale).toBe('de');
    expect(data.ca).toBeNull();
  });
});
