// @vitest-environment jsdom
import { describe, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Key } from '@ueberblick/core/model';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from '../form/model';
import { evalContext, formWorld } from '../form/form.testing';
import Harness from './testing/Harness.svelte';
import { fakeIds, fakeSubmitter, memoryDrafts } from './testing/ports';

// Timing (sheet cost on top of the bare form, and a coarse ceiling) is measured in bench/ui-task-sheet.
describe('opening a 50-field task sheet', () => {
  it('renders every field of the form', async () => {
    const properties: Record<string, Property> = {};
    const form: Record<string, object> = {};
    for (let i = 0; i < 50; i++) {
      properties[`f${i}`] = { type: 'text', label: `Field ${i}` } as unknown as Property;
      form[`f${i}`] = {};
    }
    const input = { form, properties };
    const model = buildFormModel(input);
    const { config } = formWorld(input, 'big' as Key);
    const props = {
      taskKey: 'big' as Key,
      model,
      config,
      ctx: evalContext(config),
      ids: fakeIds(),
      submitter: fakeSubmitter(),
      drafts: memoryDrafts(),
      online: true,
    };
    render(Harness, props);
    await screen.findByLabelText('Field 49');
    screen.getByLabelText('Field 0');
  });
});
