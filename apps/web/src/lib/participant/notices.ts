/**
 * Problems the app found in what it was given and cannot fix: a layer whose style is an unresolved `$ref`, a tool
 * setting that does not fit its tool, a map that would not mount. They are shown in the app (`ProblemBar`), never only
 * on the console (R11: nothing is silently replaced by a default). The codes are a registry, like every domain enum (R6).
 *
 * The registry sits here because `packages/core` is outside WP-550's `owns`; WP-577 (compile-time validation of the
 * same faults) moves it to `packages/core/src/registry`, next to `PROBLEM_CODES`.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core/registry';
import { message, type Locale } from './messages';

export const APP_PROBLEM_CODES = defineRegistry([
  {
    key: 'style_unresolved',
    description:
      'A map layer style is a `$ref` nothing resolved; the layer is not drawn. Subject: the layer key.',
  },
  {
    key: 'tool_setting_invalid',
    description: 'A tool setting does not fit its tool; the tool is not offered. Subject: the tool key.',
  },
  {
    key: 'map_unavailable',
    description: 'The map could not be mounted; the list shows the same features. Subject: the view key.',
  },
  {
    key: 'sync_host_fault',
    description: 'The sync host (the worker) failed; the sync stopped. Subject: `host`. Detail: its message.',
  },
  {
    key: 'stale_bundle',
    description:
      'This page was loaded before an update and speaks another host protocol: reload it. Subject: `host`. Detail: the host error code.',
  },
] as const);
export type AppProblemCode = KeyOf<typeof APP_PROBLEM_CODES>;

export interface AppProblem {
  readonly code: AppProblemCode;
  /** The layer, tool or view the problem is about. */
  readonly subject: string;
  /** What was found (the `$ref` path, the tool's own message). */
  readonly detail: string;
}

export interface ProblemLog {
  /** The same code and subject is kept once. */
  report(problem: AppProblem): void;
  clear(code: AppProblemCode, subject: string): void;
  list(): readonly AppProblem[];
  subscribe(listener: (problems: readonly AppProblem[]) => void): () => void;
}

export function createProblemLog(): ProblemLog {
  const problems = new Map<string, AppProblem>();
  const listeners = new Set<(p: readonly AppProblem[]) => void>();
  const changed = (): void => {
    const now = [...problems.values()];
    for (const l of [...listeners]) l(now);
  };
  const id = (code: string, subject: string): string => `${code}\u0000${subject}`;
  return {
    report(problem) {
      const key = id(problem.code, problem.subject);
      const before = problems.get(key);
      if (before?.detail === problem.detail) return;
      problems.set(key, problem);
      changed();
    },
    clear(code, subject) {
      if (problems.delete(id(code, subject))) changed();
    },
    list: () => [...problems.values()],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const TEXT = {
  style_unresolved: 'problem_style_unresolved',
  tool_setting_invalid: 'problem_tool_setting_invalid',
  map_unavailable: 'problem_map_unavailable',
  sync_host_fault: 'problem_sync_host_fault',
  stale_bundle: 'problem_stale_bundle',
} as const satisfies Record<AppProblemCode, string>;

export function problemText(locale: Locale, p: AppProblem): string {
  return message(locale, TEXT[p.code], { code: p.code, subject: p.subject, detail: p.detail });
}
