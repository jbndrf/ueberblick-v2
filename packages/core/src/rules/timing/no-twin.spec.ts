// WP-573 (R1): the server timers use core's time rules; no second cron or due-time implementation remains.
import { describe, expect, it } from 'vitest';

const server = import.meta.glob('/packages/server/src/timers/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('server timers reuse core/rules/timing', () => {
  const files = Object.entries(server).filter(([f]) => !f.endsWith('.spec.ts'));

  it('finds the server timer sources', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('defines no cron parser, next-run search or elapsed due time of its own', () => {
    for (const [file, src] of files) {
      expect(src, file).not.toMatch(
        /\b(function|const)\s+(parseCron|nextAfter|nextRun|timeRules|elapsedDueAt)\b/,
      );
      expect(src, file).not.toMatch(/from '\.\/(cron|rules)'/);
    }
  });

  it('imports them from core', () => {
    const timers = files.find(([f]) => f.endsWith('/timers.ts'))?.[1] ?? '';
    expect(timers).toContain("from '@ueberblick/core/rules/timing'");
  });
});
