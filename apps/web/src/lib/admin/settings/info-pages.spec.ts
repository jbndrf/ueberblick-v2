import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { infoPageProblem, infoPageRows, plainText } from './info-pages';

const file = (pages: Record<string, unknown>): TemplateFile =>
  ({ info_pages: pages }) as unknown as TemplateFile;

describe('infoPageRows (the list of v3 InfoPagesSection, sorted as the bootstrap sorts)', () => {
  it('lists title, content and order in the page language, authored order for equal orders', () => {
    const rows = infoPageRows(
      file({
        b: { title: { de: 'Impressum', en: 'Imprint' }, content: '<p>B</p>', sort_order: 2 },
        a: { title: 'Datenschutz', content: { de: '<p>A</p>' }, sort_order: 1 },
        c: { title: 'Hilfe', content: '<p>C</p>' },
        d: { title: 'Weitere', content: '<p>D</p>' },
      }),
      'de',
    );
    expect(rows.map((r) => [r.key, r.title, r.sortOrder])).toEqual([
      ['c', 'Hilfe', 0],
      ['d', 'Weitere', 0],
      ['a', 'Datenschutz', 1],
      ['b', 'Impressum', 2],
    ]);
    expect(rows.find((r) => r.key === 'a')?.content).toBe('<p>A</p>');
    expect(
      infoPageRows(file({ b: { title: { de: 'x', en: 'Imprint' }, content: '' } }), 'en')[0]?.title,
    ).toBe('Imprint');
  });
  it('is empty for a file with no pages', () => {
    expect(infoPageRows({} as TemplateFile, 'de')).toEqual([]);
  });
  it('property: sorted by order, and a stable sort', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(5), { maxLength: 12 }), (orders) => {
        const pages = Object.fromEntries(
          orders.map((o, i) => [`p${i}`, { title: `T${i}`, content: 'x', sort_order: o }]),
        );
        const rows = infoPageRows(file(pages), 'de');
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1];
          const cur = rows[i];
          if (prev === undefined || cur === undefined) continue;
          expect(prev.sortOrder).toBeLessThanOrEqual(cur.sortOrder);
          if (prev.sortOrder === cur.sortOrder)
            expect(Number(prev.key.slice(1))).toBeLessThan(Number(cur.key.slice(1)));
        }
      }),
    );
  });
});

describe('plainText goes through the one sanitiser (R1)', () => {
  it('drops tags, scripts and event attributes, keeps the words and entities', () => {
    expect(plainText('<h2>Datenschutz</h2><p>Mehr &amp; <a href="javascript:x()">Details</a></p>')).toBe(
      'Datenschutz Mehr & Details',
    );
    expect(plainText('<img src=x onerror=alert(1)>ok<script>alert(1)</script>')).not.toContain('<');
  });
  it('property: never returns the authored tags or their scripts', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/[<&]/.test(s)),
        (s) => {
          expect(plainText(`<p>${s}</p><script>x()</script><img src=x onerror=y>`)).not.toMatch(
            /<|script|onerror/i,
          );
        },
      ),
    );
  });
});

describe('infoPageProblem (v3 required title and content, order of 0 or more)', () => {
  const ok = { title: 'T', content: '<p>x</p>', sortOrder: 0 };
  it('accepts a complete page and refuses the rest in v3 order', () => {
    expect(infoPageProblem(ok)).toBeNull();
    expect(infoPageProblem({ ...ok, title: '  ' })).toBe('title');
    expect(infoPageProblem({ ...ok, content: '' })).toBe('content');
    expect(infoPageProblem({ ...ok, sortOrder: -1 })).toBe('sort');
    expect(infoPageProblem({ ...ok, sortOrder: Number.NaN })).toBe('sort');
  });
});
