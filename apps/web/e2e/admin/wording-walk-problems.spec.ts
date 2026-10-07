import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * WP-559: the Problems pane's German texts name the element in admin words. Engine syntax (backticks, `process.start`,
 * `choice_filter`, the old word "Regelschleife") may appear only in a "(Code: …)" hint that helps find it in the Code
 * view, never in the running text.
 */
const FILE = fileURLToPath(new URL('../../../../packages/builder/messages/de.json', import.meta.url));
const MESSAGES = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
const PROBLEMS = Object.entries(MESSAGES).filter(([k]) => k.startsWith('builder_problem_'));
const OUTSIDE_CODE_HINT = (text: string): string => text.replace(/\(Code: [^)]*\)/g, '');

test('no problem text quotes engine syntax in running text', () => {
  expect(PROBLEMS.length).toBeGreaterThan(100);
  for (const [key, value] of PROBLEMS) {
    const text = OUTSIDE_CODE_HINT(value);
    expect(text, key).not.toMatch(/`/);
    expect(text, key).not.toMatch(
      /\b(process\.start|choice_filter|inherit_position|values_at_start|permissions\.(write|see))\b/,
    );
    expect(text, key).not.toMatch(/Regelschleife|Regel-Schleife/);
  }
});

test('a sample of rewritten problem texts name the element in admin words', () => {
  expect(MESSAGES['builder_problem_choice_filter_invalid']).toContain('Filterung der Auswahlmöglichkeiten');
  expect(MESSAGES['builder_problem_process_property_default_hint']).toContain('Startphase des Ablaufs');
  expect(MESSAGES['builder_problem_rule_cycle_hint']).toContain('automatischen Aktionen');
  expect(MESSAGES['builder_problem_when_trigger_uses_time']).toContain('automatischen Aktion');
});
