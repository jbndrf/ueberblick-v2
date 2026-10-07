// The one parser of chat mentions (B-020, R1: v3 had a client copy and a server copy). A message body holds the
// tokens `@<person id>` and `#<feature id>`; this module reads them out and writes them. Pure (R2): no I/O, never
// throws. Whether an id exists is the caller's business (the server drops unknown ids from its index).

/** The longest message body of a chat, in UTF-16 units (v3: 4000). */
export const MENTION_BODY_MAX = 4000;
/** The longest id a token may carry (a participant slug with suffix, or a UUID of 36). */
export const MENTION_ID_MAX = 64;

export type MentionKind = 'person' | 'feature';

export interface MentionToken {
  readonly kind: MentionKind;
  readonly id: string;
  /** Index of the sigil in the body. */
  readonly start: number;
  /** Index after the last id character. */
  readonly end: number;
}

export interface Mentions {
  readonly persons: readonly string[];
  readonly features: readonly string[];
}

const SIGIL: Readonly<Record<MentionKind, string>> = { person: '@', feature: '#' };
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A sigil not glued to a word (so an e-mail address is no mention), then an id: lower-case alphanumeric groups joined by hyphens.
const TOKEN = /(?<![A-Za-z0-9._-])([@#])([a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** True for an id a token can carry. */
export const isMentionId = (id: string): boolean => id.length <= MENTION_ID_MAX && ID.test(id);

/** The text of one token, with no trailing space. */
export const formatMention = (kind: MentionKind, id: string): string => `${SIGIL[kind]}${id}`;

/** Every token of a body in reading order (duplicates kept), with its position. */
export function mentionTokens(body: string): MentionToken[] {
  const out: MentionToken[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const id = m[2];
    if (id === undefined || id.length > MENTION_ID_MAX) continue;
    out.push({
      kind: m[1] === '@' ? 'person' : 'feature',
      id,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** The distinct person and feature ids a body mentions, in order of first appearance. */
export function parseMentions(body: string): Mentions {
  const persons = new Set<string>();
  const features = new Set<string>();
  for (const t of mentionTokens(body)) (t.kind === 'person' ? persons : features).add(t.id);
  return { persons: [...persons], features: [...features] };
}
