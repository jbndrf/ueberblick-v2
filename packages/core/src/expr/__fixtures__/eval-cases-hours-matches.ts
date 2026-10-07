/** Corpus cases for `hours(n)` and `matches` (WP-428); part of EVAL_OK in eval-cases.ts. */
import type { Json } from '../../model';

export const EVAL_HOURS_MATCHES: readonly (readonly [string, Json])[] = [
  ["date('2026-09-29') + hours(36)", '2026-09-30T12:00:00.000Z'],
  ["date('2026-09-29T10:00:00Z') - hours(11)", '2026-09-28T23:00:00.000Z'],
  ['hours(24) == days(1)', true],
  ["date('2026-09-29') + minutes(90)", '2026-09-29T01:30:00.000Z'],
  ['minutes(60) == hours(1)', true],
  ['hours(2) + hours(3) == hours(5)', true],
  ['hours(1) + days(1) == hours(25)', true],
  ['-hours(1) < hours(0)', true],
  ['now - hours(1) < now', true],
  // matches (safe pattern subset, search semantics, no backtracking)
  ["matches('Linde', 'inde')", true],
  ["matches('Linde', '^inde')", false],
  ["'Linde'.matches('^L.*e$')", true],
  ["self.art.matches('^[A-Z][a-z]+$')", true],
  ["matches('2026-09-30', '^\\\\d{4}-\\\\d{2}-\\\\d{2}$')", true],
  ["matches('a@b.de', '^[^@ ]+@[^@ ]+\\\\.[a-z]{2,}$')", true],
  ["matches('abc', '^(ab|cd)+$')", false],
  ["matches('', '^$')", true],
  ["matches('äöü', '^\\\\w+$')", false],
  ["matches('a\\nb', 'a.b')", false],
];
