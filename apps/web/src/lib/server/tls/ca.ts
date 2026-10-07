/**
 * The public side of the local CA (WP-941): what `/setup/zertifikat` offers. Only `<dataDir>/tls/ca.crt` is read, and
 * only when it really is a CA certificate; the CA key and the server key are never opened here.
 */
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';

export interface PublicCa {
  /** The certificate as PEM (the `.crt` download). */
  readonly pem: string;
  /** SHA-256 of the certificate, uppercase hex with colons, so a person can compare it on the phone. */
  readonly fingerprint: string;
}

/** The CA certificate, or null while there is none (proxy mode, or the front has not made it yet). */
export function publicCa(dataDir: string, file = 'ca.crt'): PublicCa | null {
  try {
    const pem = readFileSync(join(dataDir, 'tls', file), 'utf8');
    const cert = new X509Certificate(pem);
    return cert.ca ? { pem, fingerprint: cert.fingerprint256 } : null;
  } catch {
    return null;
  }
}

/** The certificate as DER bytes. */
export const caDer = (pem: string): Buffer => new X509Certificate(pem).raw;

const uuidFrom = (seed: string): string => {
  const h = createHash('sha256').update(seed).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/**
 * An iOS configuration profile that installs the CA as a root certificate. The identifiers come from the certificate,
 * so the same CA always makes the same profile and a second download replaces the first on the phone.
 */
export function mobileconfig(pem: string): string {
  const der = caDer(pem);
  const id = uuidFrom(der.toString('base64'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>ueberblick-ca.crt</string>
      <key>PayloadContent</key>
      <data>${der.toString('base64')}</data>
      <key>PayloadDescription</key>
      <string>Ueberblick Local CA</string>
      <key>PayloadDisplayName</key>
      <string>Ueberblick Local CA</string>
      <key>PayloadIdentifier</key>
      <string>org.ueberblick.ca.cert.${id}</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${uuidFrom(`cert:${id}`)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>Ueberblick</string>
  <key>PayloadIdentifier</key>
  <string>org.ueberblick.ca.${id}</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${id}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

/** The address of the setup page on the public address (`PUBLIC_URL`, an origin without path). */
export const setupPageUrl = (publicUrl: string): string => `${publicUrl}/setup/zertifikat`;

/** An inline SVG of the code, scalable, error correction M, with the four-module quiet zone. */
export function qrSvg(text: string): string {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  return code.createSvgTag({ cellSize: 1, margin: 4, scalable: true });
}
