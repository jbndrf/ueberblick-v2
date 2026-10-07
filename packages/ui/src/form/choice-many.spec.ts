// @vitest-environment jsdom
// WP-443 (v3 "Mehrfachauswahl"): a participant or reference property with `cardinality: many` is picked several at a time
// and holds a list of ids; with one (the default) it holds one id.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import '../components/ui/jsdom-shims.testing';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
const choices = {
  ref: [
    { value: 'f1', label: 'Linde' },
    { value: 'f2', label: 'Eiche' },
  ],
  who: [
    { value: 'u1', label: 'Ada' },
    { value: 'u2', label: 'Bo' },
  ],
};

function setup(props: Record<string, Property>, initial: Record<string, unknown> = {}) {
  const form = Object.fromEntries(Object.keys(props).map((k) => [k, {}]));
  const input = { form, properties: props };
  const session = createFormSession(
    buildFormModel(input),
    sessionOptions(input, undefined, { initial: initial as never }),
  );
  const onsubmit = vi.fn();
  render(FormRenderer, { session, onsubmit, choices });
  return { session, onsubmit };
}

describe('model', () => {
  it('marks a many choice as multiple and leaves a one choice alone', () => {
    const input = {
      form: { a: {}, b: {}, c: {} },
      properties: {
        a: P('reference', { to: 'objekt', cardinality: 'many' }),
        b: P('participant', { cardinality: 'many' }),
        c: P('reference', { to: 'objekt' }),
      },
    };
    const m = buildFormModel(input);
    expect(m.fields.map((f) => f.multiple)).toEqual([true, true, undefined]);
  });
});

describe('a many reference and a many participant in the form', () => {
  const props = {
    ref: P('reference', { to: 'objekt', label: 'Bäume', cardinality: 'many' }),
    who: P('participant', { label: 'Beteiligte', cardinality: 'many' }),
  };

  it('picks several and holds a list of ids; a pick can be taken back', async () => {
    const { session } = setup(props);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Bäume'));
    await user.click(screen.getByRole('option', { name: 'Linde' }));
    await user.click(screen.getByRole('option', { name: 'Eiche' }));
    await user.keyboard('{Escape}');
    expect(session.get('ref')).toEqual(['f1', 'f2']);
    await user.click(screen.getByLabelText('Bäume'));
    await user.click(screen.getByRole('option', { name: 'Linde' }));
    await user.keyboard('{Escape}');
    expect(session.get('ref')).toEqual(['f2']);
    await user.click(screen.getByLabelText('Beteiligte'));
    await user.click(screen.getByRole('option', { name: 'Ada' }));
    await user.click(screen.getByRole('option', { name: 'Bo' }));
    await user.keyboard('{Escape}');
    expect(session.get('who')).toEqual(['u1', 'u2']);
  });

  it('validates a list of ids as the right type and refuses a single id', () => {
    const { session } = setup(props, { ref: ['f1'], who: 'u1' });
    const issues = session.validateAll();
    expect(issues.find((i) => i.fieldKey === 'ref')).toBeUndefined();
    expect(issues.find((i) => i.fieldKey === 'who')?.kind).toBe('type');
  });

  it('a single reference still holds one id', async () => {
    const { session } = setup({ ref: P('reference', { to: 'objekt', label: 'Baum' }) });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Baum'));
    await user.click(screen.getByRole('option', { name: 'Eiche' }));
    expect(session.get('ref')).toBe('f2');
  });
});
