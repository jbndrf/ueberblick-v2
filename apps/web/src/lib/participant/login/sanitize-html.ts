/**
 * Minimal HTML sanitiser for operator-written text (the consent body and the legal pages), ported from v3
 * `src/lib/sanitize-html.ts`: only a small tag set survives, no attribute except a safe `href`, everything else is
 * escaped or dropped. Differences from v3: an existing entity (`&amp;`, `&nbsp;`) is kept instead of escaped twice,
 * and only http(s), mailto, tel and relative links keep their `href` (v3 dropped `javascript:` only).
 */
const ALLOWED_TAGS = new Set([
  'a',
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);
const VOID_TAGS = new Set(['br']);
const SAFE_HREF = /^(?:https?:|mailto:|tel:|\/|#|\.)/i;

const escapeText = (s: string): string =>
  s
    .replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

function extractHref(attrs: string): string | null {
  const match = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!match) return null;
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  return SAFE_HREF.test(value) ? value : null;
}

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const out: string[] = [];
  const stack: string[] = [];
  const token =
    /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9]*)\s*>|<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)\s*(\/?)>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    if (match.index > last) out.push(escapeText(html.slice(last, match.index)));
    last = token.lastIndex;
    const [whole, close, open, attrs = ''] = match;
    if (whole.startsWith('<!--')) continue;
    if (close !== undefined) {
      const tag = close.toLowerCase();
      if (!ALLOWED_TAGS.has(tag) || VOID_TAGS.has(tag)) continue;
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (open === undefined) continue;
    const tag = open.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (tag === 'a') {
      const href = extractHref(attrs);
      out.push(
        `<a${href === null ? '' : ` href="${escapeAttr(href)}"`} target="_blank" rel="noopener noreferrer">`,
      );
      stack.push('a');
    } else if (VOID_TAGS.has(tag) || match[4] === '/') out.push(`<${tag}>`);
    else {
      out.push(`<${tag}>`);
      stack.push(tag);
    }
  }
  if (last < html.length) out.push(escapeText(html.slice(last)));
  while (stack.length > 0) out.push(`</${stack.pop()}>`);
  return out.join('');
}
