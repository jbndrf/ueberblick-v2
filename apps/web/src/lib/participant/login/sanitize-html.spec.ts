import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize-html';

describe('sanitizeHtml (ported from v3 sanitize-html.ts)', () => {
  it('keeps the allowed tags and escapes everything else', () => {
    expect(
      sanitizeHtml('<h2>Titel</h2><p>a <strong>b</strong> &amp; c &lt; d & e</p><ul><li>x</li></ul>'),
    ).toBe('<h2>Titel</h2><p>a <strong>b</strong> &amp; c &lt; d &amp; e</p><ul><li>x</li></ul>');
  });

  it('drops scripts, handlers, styles and comments, and closes open tags', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">a<script>alert(1)</script><!-- c --><img src=x onerror=y><i>b',
    );
    expect(out).not.toMatch(/onclick|<script|<img|onerror|<!--/);
    expect(out).toBe('<p>aalert(1)<i>b</i></p>');
  });

  it('links open in a new tab with noopener, and unsafe schemes lose their href', () => {
    expect(sanitizeHtml('<a href="https://x.org/a?b=1&c=2">x</a>')).toBe(
      '<a href="https://x.org/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('href');
    expect(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).not.toContain('href');
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).not.toContain('href');
    expect(sanitizeHtml('<a href="/legal/impressum">x</a>')).toContain('href="/legal/impressum"');
    expect(sanitizeHtml('<a href="mailto:a@b.de">x</a>')).toContain('href="mailto:a@b.de"');
  });

  it('is empty for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
