// @vitest-environment jsdom
// WP-790: an open form follows a runtime language switch (labels, required marks) and keeps what was typed.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Key, Property } from '@ueberblick/core/model';
import { buildFormModel } from '../form/model';
import { evalContext, formWorld } from '../form/form.testing';
import Harness from './testing/Harness.svelte';
import { fakeIds, fakeSubmitter, memoryDrafts } from './testing/ports';
import type { TaskSheetProps } from './contract';

afterEach(cleanup);

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
const input = {
  form: { vitalitaet: { required: true }, befund: {} },
  properties: {
    vitalitaet: P('integer', { label: { de: 'Vitalität', en: 'Vitality' } }),
    befund: P('text', { label: { de: 'Befund', en: 'Finding' } }),
  },
};
const { config } = formWorld(input, 'kontrolle' as Key);

describe('locale switch', () => {
  it('re-renders the field labels in the new locale and keeps the typed value', async () => {
    const props: TaskSheetProps = {
      taskKey: 'kontrolle' as Key,
      model: buildFormModel(input),
      config,
      ctx: evalContext(config),
      ids: fakeIds(),
      submitter: fakeSubmitter(0),
      drafts: memoryDrafts(),
      online: false,
      featureIds: ['f1' as FeatureId],
      locale: 'en',
    };
    const view = render(Harness, props);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Finding/), 'rot');
    await view.rerender({ ...props, locale: 'de' });
    const field = await screen.findByLabelText(/Befund/);
    expect((field as HTMLInputElement).value).toBe('rot');
    expect(screen.queryByLabelText(/Finding/)).toBeNull();
    expect(screen.getByLabelText(/Vitalität/)).toBeTruthy();
  });
});
