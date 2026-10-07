import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseInfoPage } from './render';

const login = { token: 'tok123', link: 'https://x.test/l/tok123' };

describe('parseInfoPage (v3 info-page-render.ts)', () => {
  it('replaces $token and $loginlink in text', () => {
    const [seg] = parseInfoPage('<p>Dein Token: $token, Link: $loginlink</p>', login);
    expect(seg).toEqual({
      kind: 'html',
      html: '<p>Dein Token: tok123, Link: https://x.test/l/tok123</p>',
    });
  });

  it('turns $qrtoken and $qrloginlink into qr segments with the right values, in order', () => {
    const segs = parseInfoPage('<p>a</p>$qrloginlink<p>b</p>$qrtoken', login);
    expect(segs.map((s) => (s.kind === 'qr' ? `qr:${s.value}` : 'html'))).toEqual([
      'html',
      'qr:https://x.test/l/tok123',
      'html',
      'qr:tok123',
    ]);
  });

  it('drops the QR markers and keeps the variables when there is no login', () => {
    const segs = parseInfoPage('<p>$token</p>$qrtoken', null);
    expect(segs).toEqual([{ kind: 'html', html: '<p>$token</p>' }]);
  });

  it('sanitises after replacing: scripts and event attributes are gone', () => {
    const [seg] = parseInfoPage('<p onclick="x()">hi<script>alert(1)</script></p>', login);
    expect(JSON.stringify(seg)).not.toMatch(/script|onclick/);
  });

  it('never throws and never leaves a QR marker in html output', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const s of parseInfoPage(text + '$qrtoken' + text, login))
          if (s.kind === 'html') expect(s.html).not.toContain('$qrtoken');
      }),
    );
  });
});
