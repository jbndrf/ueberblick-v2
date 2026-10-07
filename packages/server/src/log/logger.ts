import {
  LOG_EVENTS,
  LOG_LEVELS,
  type LogEventKey,
  type LogEventSpec,
  type LogFields,
  type LogFieldKind,
  type LogLevel,
} from './events';
import { truncateIp } from './ip';

/** The logger port. Only registry-declared events and fields can be logged. */
export interface Logger {
  log<K extends LogEventKey>(event: K, fields: LogFields<K>): void;
}

/** Where a finished line goes (stdout in production, an array in tests). */
export type LogSink = (line: string) => void;

export interface LoggerOptions {
  readonly sink: LogSink;
  /** Injected clock (ms since epoch); the log module never reads the system time itself. */
  readonly now: () => number;
  /** Lowest level written; default `info`. */
  readonly minLevel?: LogLevel;
}

const RANK = new Map<string, number>(LOG_LEVELS.keys.map((k, i) => [k, i]));
const SPECS = new Map<string, LogEventSpec>(LOG_EVENTS.map((e) => [e.key, e]));

function render(kind: LogFieldKind, v: string | number): string | number {
  return kind === 'ip' ? truncateIp(String(v)) : v;
}

export function createLogger(opts: LoggerOptions): Logger {
  const min = RANK.get(opts.minLevel ?? 'info') ?? 1;
  return {
    log(event, fields) {
      const spec = SPECS.get(event);
      if (!spec || (RANK.get(spec.level) ?? 0) < min) return;
      const line: Record<string, string | number> = { t: opts.now(), level: spec.level, event };
      const given = fields as Record<string, string | number>;
      // Runtime guard behind the type: undeclared names are dropped, never written.
      for (const [name, kind] of Object.entries(spec.fields)) {
        const v = given[name];
        if (v !== undefined) line[name] = render(kind, v);
      }
      opts.sink(JSON.stringify(line));
    },
  };
}

/** Days a log line is kept by whoever rotates the files, when `LOG_RETENTION_DAYS` is unset. */
export const DEFAULT_LOG_RETENTION_DAYS = 30;

/** Reads `LOG_RETENTION_DAYS`: the default when unset, otherwise a positive integer or a thrown error (R11). */
export function logRetentionDays(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env['LOG_RETENTION_DAYS'];
  if (raw === undefined) return DEFAULT_LOG_RETENTION_DAYS;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n) || n <= 0)
    throw new Error(`LOG_RETENTION_DAYS must be a positive whole number of days, got "${raw}"`);
  return n;
}
