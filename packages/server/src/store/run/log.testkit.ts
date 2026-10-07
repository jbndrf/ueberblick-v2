/** Test helper: a real logger over an array sink, and the privacy assertion every event test makes (WP-163). */
import { expect } from 'vitest';
import { LOG_EVENTS, createLogger, type Logger } from '../../log';

export type LogLine = Record<string, string | number> & { event: string; level: string; t: number };

export interface LogSpy {
  readonly log: Logger;
  /** The lines written so far, parsed; `only(event)` filters by event key. */
  lines(): LogLine[];
  only(event: string): LogLine[];
}

export function logSpy(): LogSpy {
  const raw: string[] = [];
  const log = createLogger({ sink: (l) => raw.push(l), now: () => 1 });
  const lines = (): LogLine[] => raw.map((l) => JSON.parse(l) as LogLine);
  return { log, lines, only: (event) => lines().filter((l) => l.event === event) };
}

/** Every line carries only `t`, `level`, `event` and the fields its event declares (no value, input, name, full IP). */
export function expectDeclaredFieldsOnly(lines: readonly LogLine[]): void {
  for (const line of lines) {
    const spec = LOG_EVENTS.find((e) => e.key === line.event);
    expect(spec, `unknown event ${line.event}`).toBeDefined();
    const allowed = new Set(['t', 'level', 'event', ...Object.keys(spec?.fields ?? {})]);
    expect(Object.keys(line).filter((k) => !allowed.has(k))).toEqual([]);
  }
}
