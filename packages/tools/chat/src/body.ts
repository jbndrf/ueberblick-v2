// A message body as chips (v3 `MessageList.svelte:268-279`): `@<person>` and `#<feature>` tokens are read by core's
// one parser (R1); the text between them stays text. Pure.
import { mentionTokens } from '@ueberblick/core/mentions';

export type BodySegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'person'; readonly id: string; readonly me: boolean }
  | { readonly kind: 'feature'; readonly id: string };

export function bodySegments(body: string, self: string): BodySegment[] {
  const out: BodySegment[] = [];
  let at = 0;
  for (const t of mentionTokens(body)) {
    if (t.start > at) out.push({ kind: 'text', text: body.slice(at, t.start) });
    out.push(
      t.kind === 'person' ? { kind: 'person', id: t.id, me: t.id === self } : { kind: 'feature', id: t.id },
    );
    at = t.end;
  }
  if (at < body.length) out.push({ kind: 'text', text: body.slice(at) });
  return out;
}
