/** A config with a chain of automatic actions longer than the platform limit (WP-104). */
import { PLAN_MAX_RULE_DEPTH, type CompiledConfig, type TemplateFile } from '@ueberblick/core';
import { build } from './testkit';

/** `start` triggers step_0, which triggers step_1, ... : a chain of `length` automatic runs (compile forbids cycles). */
export function deepChain(length = PLAN_MAX_RULE_DEPTH + 2): CompiledConfig {
  const range = Array.from({ length }, (_, i) => i);
  const file = {
    schema: 'ueberblick/1',
    template: { key: 'chain', version: '1.0.0' },
    types: {
      thing: { label: 'Thing', properties: { n: { type: 'integer' } } },
    },
    tasks: {
      start: { label: 'Start', on: '$none', creates: 'thing', form: { n: {} } },
      ...Object.fromEntries(
        range.map((i) => [
          `step_${i}`,
          {
            label: `Step ${i}`,
            on: 'thing',
            auto: { [i === 0 ? 'first' : `next_${i}`]: { after: i === 0 ? 'start' : `step_${i - 1}` } },
          },
        ]),
      ),
    },
  } as unknown as TemplateFile;
  return build(file);
}
