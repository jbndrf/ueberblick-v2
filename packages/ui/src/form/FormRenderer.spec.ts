// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import '../components/ui/jsdom-shims.testing';
import { axeViolations } from '../testing/axe';
import { TARGET_SIZE } from '../tokens';
import type { Json, SessionOptions } from './contract';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
type Form = Parameters<typeof buildFormModel>[0]['form'];

type Opts = Partial<SessionOptions> & { self?: Record<string, Json> };

function setup(form: Form, props: Record<string, Property>, opts: Opts = {}, extra = {}) {
  const { self, ...rest } = opts;
  const input = { form, properties: props };
  const session = createFormSession(buildFormModel(input), sessionOptions(input, self, rest));
  const onsubmit = vi.fn();
  const view = render(FormRenderer, { session, onsubmit, ...extra });
  return { session, onsubmit, ...view };
}

const tool = createRawSnippet((slot: () => { field: { key: string } }) => ({
  render: () => `<button type="button" data-tool="${slot().field.key}">use tool</button>`,
}));

describe('inputs per property type', () => {
  const props = {
    t: P('text', { label: 'Text' }),
    n: P('number', { label: 'Number' }),
    b: P('boolean', { label: 'Flag' }),
    d: P('date', { label: 'Day' }),
    tm: P('time', { label: 'Uhrzeit' }),
    s: P('select', { label: 'Pick', options: { a: 'Alpha', b: { en: 'Beta', de: 'Beta' } } }),
    ms: P('multiselect', { label: 'Many', options: { x: 'X', y: 'Y' } }),
    p: P('participant', { label: 'Person' }),
    f: P('file', { label: 'Photo' }),
    g: P('geometry', { label: 'Where' }),
  };

  it('draws an input for each type; file and geometry use the tool slot', async () => {
    const { session } = setup(
      Object.fromEntries(Object.keys(props).map((k) => [k, {}])),
      props,
      {},
      { tool, choices: { p: [{ value: 'u1', label: 'Ada' }] } },
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Text'), 'hi');
    await user.type(screen.getByLabelText('Number'), '4');
    await user.click(screen.getByLabelText('Flag'));
    await user.type(screen.getByLabelText('Uhrzeit'), '1430');
    expect((screen.getByLabelText('Uhrzeit') as HTMLInputElement).type).toBe('time');
    await user.click(screen.getByLabelText('Pick'));
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    await user.click(screen.getByLabelText('Many'));
    await user.click(screen.getByRole('option', { name: 'Y' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByLabelText('Person'));
    await user.click(screen.getByRole('option', { name: 'Ada' }));
    expect(document.querySelectorAll('[data-tool]')).toHaveLength(2);
    expect(session.draft()).toMatchObject({
      t: 'hi',
      n: 4,
      b: true,
      tm: '14:30',
      s: 'a',
      ms: ['y'],
      p: 'u1',
    });
  });

  it('without a tool snippet the slot says so instead of rendering blank', () => {
    setup({ f: {} }, { f: P('file', { label: 'Photo' }) });
    expect(screen.getByText(/not available/i)).toBeTruthy();
  });
});

describe('relevant', () => {
  it('hides non-relevant fields and shows them when they become relevant', async () => {
    const { onsubmit } = setup(
      { vitalitaet: { required: false }, befund: { relevant: 'form.vitalitaet >= 3' } },
      { vitalitaet: P('integer', { label: 'Vitality' }), befund: P('text', { label: 'Finding' }) },
    );
    expect(screen.queryByLabelText('Finding')).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Vitality'), '4');
    await user.type(screen.getByLabelText('Finding'), 'rot');
    await user.clear(screen.getByLabelText('Vitality'));
    await user.type(screen.getByLabelText('Vitality'), '1');
    expect(screen.queryByLabelText('Finding')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onsubmit).toHaveBeenCalledWith({ vitalitaet: 1 });
  });
});

describe('submit with errors', () => {
  const props = { befund: P('text', { label: 'Finding' }), zahl: P('integer', { label: 'Count' }) };
  const form: Form = {
    befund: {
      constraint: 'value != self.befund',
      constraint_message: { en: 'Finding must change', de: 'Muss sich ändern' },
    },
    zahl: { required: true },
  };

  it('focuses the ErrorSummary, links focus their field, constraint_message is shown', async () => {
    const { onsubmit } = setup(form, props, { self: { befund: 'old' }, initial: { befund: 'old' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByRole('alert');
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getByRole('link', { name: 'Finding must change' })).toBeTruthy();
    expect(onsubmit).not.toHaveBeenCalled();
    await user.click(within(summary).getByRole('link', { name: /Count is required/ }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Count/));
    expect(screen.getByLabelText(/Count/).getAttribute('aria-invalid')).toBe('true');
  });

  it('is axe clean with errors showing', async () => {
    const { container } = setup(form, props, { self: { befund: 'old' }, initial: { befund: 'old' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('draft', () => {
  it('reports the draft after each change and it can be read at any time', async () => {
    const ondraft = vi.fn();
    const { session } = setup({ a: {} }, { a: P('text', { label: 'First' }) }, {}, { ondraft });
    await userEvent.setup().type(screen.getByLabelText('First'), 'x');
    expect(ondraft).toHaveBeenLastCalledWith({ a: 'x' });
    expect(session.draft()).toEqual({ a: 'x' });
  });
});

describe('field-proof', () => {
  it('the primary action is at least 56 px and the form has no axe violations', async () => {
    const { container } = setup(
      { a: { required: true }, s: {} },
      { a: P('text', { label: 'First' }), s: P('select', { label: 'Pick', options: { a: 'A' } }) },
    );
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(parseFloat(getComputedStyle(submit).minHeight)).toBeGreaterThanOrEqual(TARGET_SIZE.primary);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('works by keyboard alone: tab to a field, type, tab to submit, press Enter', async () => {
    const { onsubmit } = setup({ a: { required: true } }, { a: P('text', { label: 'First' }) });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/First/));
    await user.keyboard('ok');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Submit' }));
    await user.keyboard('{Enter}');
    expect(onsubmit).toHaveBeenCalledWith({ a: 'ok' });
  });
});
