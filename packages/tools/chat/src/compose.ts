// The composer's text editing (v3 `Composer.svelte`, `mentions.ts:100-168`), pure: where a picked name goes, how a
// seed joins the draft, and which key sends. The DOM code only reads and writes the textarea.
import { formatMention } from '@ueberblick/core/mentions';

export interface Edit {
  readonly value: string;
  /** Where the caret goes. */
  readonly caret: number;
}

/** An `@` the caret stands right behind (at the start or after white space), with what was typed after it. */
export function activeMentionTrigger(
  value: string,
  caret: number,
): { readonly start: number; readonly query: string } | null {
  if (caret < 0 || caret > value.length) return null;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value.charAt(i);
    if (ch === '@') {
      const before = i === 0 ? '' : value.charAt(i - 1);
      return before !== '' && !/\s/.test(before) ? null : { start: i, query: value.slice(i + 1, caret) };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/**
 * A picked person: `@<id> ` replaces a typed `@query`, else it goes in at the caret, after a space when the word
 * before it would otherwise touch it (v3 `insertMentionAtCursor`).
 */
export function insertPerson(value: string, caret: number, id: string): Edit {
  const trigger = activeMentionTrigger(value, caret);
  const token = `${formatMention('person', id)} `;
  if (trigger !== null) {
    const before = value.slice(0, trigger.start);
    return { value: before + token + value.slice(caret), caret: before.length + token.length };
  }
  const before = value.slice(0, caret);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  return {
    value: before + lead + token + value.slice(caret),
    caret: before.length + lead.length + token.length,
  };
}

/** A one-shot seed ("#<feature> " from "Im Chat erwähnen") is appended to the draft; nothing is sent (v3 `Composer:37-52`). */
export function appendSeed(value: string, seed: string): Edit {
  const lead = value !== '' && !/\s$/.test(value) ? ' ' : '';
  const next = value + lead + seed;
  return { value: next, caret: next.length };
}

export interface SendKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** An input method (IME) is composing: Enter then confirms the composition. */
  readonly isComposing?: boolean;
}

/** Enter sends; Shift+Enter and Alt+Enter add a line (v3 `Composer:115-120`). */
export const isSendKey = (e: SendKey): boolean =>
  e.key === 'Enter' && !e.shiftKey && !e.altKey && e.isComposing !== true;

/** What is sent: the draft, trimmed. Empty means nothing is sent. */
export const bodyOf = (value: string): string => value.trim();
