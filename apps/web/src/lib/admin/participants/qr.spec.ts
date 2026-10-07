import { describe, expect, it } from 'vitest';
import { decodeQr, modulesOfSvg } from './qr-decode.testkit';
import { qrSvg } from './qr';

const LINKS = [
  'https://x.test/login?token=ABCDEFGHJKLMNPQR-23456789',
  'http://sub.other:8080/login?token=abcdefghij',
];

describe('qrSvg', () => {
  it.each(LINKS)('draws an SVG that decodes to the link %s', async (link) => {
    const svg = await qrSvg(link);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(decodeQr(svg)).toBe(link);
  });

  it('is deterministic and draws a square code with a quiet zone', async () => {
    const link = LINKS[0] ?? '';
    const a = await qrSvg(link);
    expect(await qrSvg(link)).toBe(a);
    const { size, dark } = modulesOfSvg(a);
    expect(dark).toHaveLength(size);
    expect(dark[0]?.slice(0, 7).every(Boolean)).toBe(true); // the top edge of the first finder pattern
  });

  it('carries no script and no external reference', async () => {
    const svg = await qrSvg(LINKS[0] ?? '');
    expect(svg).not.toMatch(/<script|href=|on\w+=|<image/i);
  });
});
