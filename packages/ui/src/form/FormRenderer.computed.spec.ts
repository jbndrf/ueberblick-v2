// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import '../components/ui/jsdom-shims.testing';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;

describe('a computed field in the form (WP-801)', () => {
  const input = {
    form: { t: {}, c: {} } as never,
    properties: { t: P('text', { label: 'Text' }), c: P('text', { label: 'Sum', computed: '"x"' }) },
  };
  // The compiler refuses a task that writes a computed property (`computed_written`), so the engine side of the
  // session is built from plain properties; the model carries the `computed` flag the renderer reads.
  const plain = { ...input, properties: { t: input.properties.t, c: P('text', { label: 'Sum' }) } };
  const session = createFormSession(
    buildFormModel(input),
    sessionOptions(plain, {}, { initial: { t: 'a', c: 'stale' } } as never),
  );
  it('shows the text and badge, has no input, submits no value', () => {
    session.set('c', 'forced');
    render(FormRenderer, { session, onsubmit: () => {}, oncancel: () => {} });
    expect(screen.getByTestId('computed-field')).toBeTruthy();
    expect(document.querySelector('[data-field-id="ub-field-c"] input')).toBeNull();
    expect(screen.getByTestId('computed-badge').textContent).toContain('Computed'); // the ui Badge, as the origin badge
    expect('c' in session.submitValues()).toBe(false);
    expect('t' in session.submitValues()).toBe(true);
  });

  afterEach(cleanup);

  it('the submit handler never gets the computed key (the run would be invalid_input), also after clearing (WP-828)', async () => {
    const sent: Record<string, unknown>[] = [];
    const s = createFormSession(
      buildFormModel(input),
      sessionOptions(plain, {}, { initial: { t: 'a', c: 'stale' } } as never),
    );
    s.set('c', 'forced');
    s.set('t', '');
    render(FormRenderer, {
      session: s,
      onsubmit: (v: Record<string, unknown>) => {
        sent.push(v);
      },
      oncancel: () => {},
    });
    const form = document.querySelector('form') as HTMLFormElement;
    await fireEvent.submit(form);
    // t was cleared, so the warning shows first; confirm it
    const confirm = document.querySelector(
      '[role="alertdialog"] button:last-of-type, [role="dialog"] button:last-of-type',
    );
    if (confirm) await fireEvent.click(confirm);
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).not.toHaveProperty('c');
    expect(s.submitValuesCleared()).not.toHaveProperty('c');
  });
});
