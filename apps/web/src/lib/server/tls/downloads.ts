/** The responses of `/setup/zertifikat` (WP-941). Public data only: see `ca.ts`. */
import { localeOf } from '../../participant/locale-tag';
import type { Locale } from '../../participant/messages';
import { mobileconfig, publicCa, qrSvg, setupPageUrl } from './ca';

const notFound = (): Response => new Response('no certificate authority on this server', { status: 404 });
const attachment = (type: string, file: string): Record<string, string> => ({
  'content-type': type,
  'content-disposition': `attachment; filename="${file}"`,
  'cache-control': 'no-cache',
});

export function caCertificateResponse(dataDir: string): Response {
  const ca = publicCa(dataDir);
  return ca === null
    ? notFound()
    : new Response(ca.pem, { headers: attachment('application/x-x509-ca-cert', 'ueberblick-ca.crt') });
}

export function mobileconfigResponse(dataDir: string): Response {
  const ca = publicCa(dataDir);
  return ca === null
    ? notFound()
    : new Response(mobileconfig(ca.pem), {
        headers: attachment('application/x-apple-aspen-config', 'ueberblick.mobileconfig'),
      });
}

export interface SetupPageData {
  readonly locale: Locale;
  readonly ca: { readonly fingerprint: string } | null;
  readonly qr: string;
  readonly pageUrl: string;
}

/** German unless the browser asks for English first (as the page language in `hooks.server.ts`). */
export function setupPageData(
  dataDir: string,
  publicUrl: string,
  acceptLanguage: string | null,
): SetupPageData {
  const pageUrl = setupPageUrl(publicUrl);
  const ca = publicCa(dataDir);
  return {
    locale: localeOf((acceptLanguage ?? '').trim()),
    ca: ca === null ? null : { fingerprint: ca.fingerprint },
    qr: qrSvg(pageUrl),
    pageUrl,
  };
}
