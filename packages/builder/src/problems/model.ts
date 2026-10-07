/**
 * The problems list as data (H4). The panel and the HTTP route both call this; nothing about a
 * problem is decided in the UI. Message and hint are worded in `locale` by the builder catalogue (`text.ts`).
 */
import type { KeyPath, ProblemCode } from '@ueberblick/core';
import type { Doc } from '../doc';
import { locate, type Location } from '../shell/location';
import { problemText } from './text';

export interface ProblemItem {
  /** Unique within one list (position plus code plus path), for keyed lists. */
  readonly id: string;
  readonly path: KeyPath;
  readonly code: ProblemCode;
  readonly message: string;
  readonly hint?: string;
  /** Where the builder shows the entity this problem is about. */
  readonly location: Location;
}

export function problemItems(doc: Doc, locale: string): readonly ProblemItem[] {
  const file = doc.effective();
  return doc.problems().map((p, i) => {
    const { message, hint } = problemText(p, locale);
    return {
      id: `${i}:${p.code}:${p.path}`,
      path: p.path,
      code: p.code,
      message,
      ...(hint === undefined ? {} : { hint }),
      location: locate(file, p.path),
    };
  });
}

/** What `GET .../problems` returns: the list and the revision of the document it belongs to. */
export interface ProblemsReport {
  readonly revision: string;
  readonly count: number;
  readonly problems: readonly ProblemItem[];
}

export function problemsReport(doc: Doc, locale: string): ProblemsReport {
  const problems = problemItems(doc, locale);
  return { revision: doc.revision, count: problems.length, problems };
}
