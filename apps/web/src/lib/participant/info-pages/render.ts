/**
 * Info page text with the participant's own login in it (v3 `info-page-render.ts`). `$token` and `$loginlink` are
 * replaced by text; `$qrtoken` and `$qrloginlink` become standalone `qr` segments the dialog draws as a QR code. A marker
 * whose value is missing (no active token) is dropped silently, as v3 did: admins embed them defensively. The HTML goes
 * through the one shared sanitiser, after the replacement.
 */
import { sanitizeHtml } from '../login/sanitize-html';

export interface InfoLogin {
  readonly token: string;
  readonly link: string;
}
export type InfoSegment =
  { readonly kind: 'html'; readonly html: string } | { readonly kind: 'qr'; readonly value: string };

const QR_MARKERS: ReadonlyArray<{ marker: string; value: (l: InfoLogin) => string }> = [
  { marker: '$qrloginlink', value: (l) => l.link },
  { marker: '$qrtoken', value: (l) => l.token },
];
const MARKER_RE = new RegExp(QR_MARKERS.map((m) => m.marker.replace('$', '\\$')).join('|'), 'g');

function substitute(text: string, login: InfoLogin | null): string {
  if (login === null) return text;
  return text.replace(/\$loginlink\b/g, () => login.link).replace(/\$token\b/g, () => login.token);
}

export function parseInfoPage(content: string, login: InfoLogin | null): InfoSegment[] {
  const segments: InfoSegment[] = [];
  const html = (raw: string): void => {
    if (raw !== '') segments.push({ kind: 'html', html: sanitizeHtml(substitute(raw, login)) });
  };
  let cursor = 0;
  for (const match of content.matchAll(MARKER_RE)) {
    html(content.slice(cursor, match.index));
    const value = login === null ? undefined : QR_MARKERS.find((m) => m.marker === match[0])?.value(login);
    if (value !== undefined && value !== '') segments.push({ kind: 'qr', value });
    cursor = match.index + match[0].length;
  }
  html(content.slice(cursor));
  return segments;
}
