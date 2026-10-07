import { describe, expect, it } from 'vitest';
import { formApi } from '@ueberblick/core';
import type { Key } from '@ueberblick/core/model';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { formWorld, sessionOptions } from './form.testing';

describe('relevance re-evaluation on a 50-field form (timing: bench/ui-form)', () => {
  const properties: Record<string, Property> = {};
  const form: Record<string, { relevant?: string; constraint: string }> = {};
  for (let i = 0; i < 50; i++) {
    properties[`f${i}`] = { type: 'text' } as Property;
    form[`f${i}`] = { constraint: "value != 'x'", ...(i > 0 && { relevant: "form.f0 != 'hide'" }) };
  }
  const input = { form, properties };

  it('the session follows the dependents core.form reports', () => {
    const { config, task } = formWorld(input);
    expect(formApi.dependents(task, config, 'f7' as Key)).toEqual(['f7']);
    expect(formApi.dependents(task, config, 'f0' as Key)).toHaveLength(50);
    const s = createFormSession(buildFormModel(input), sessionOptions(input));
    s.set('f0', 'hide');
    expect(s.visibleFields(0).map((f) => f.key)).toEqual(['f0']);
  });
});
