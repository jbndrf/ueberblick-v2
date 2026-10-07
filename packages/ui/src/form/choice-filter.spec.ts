// @vitest-environment jsdom
// WP-392 (E-25, ODK choice_filter): the dependent select offers the filtered options with their explanation text, on
// the phone select sheet (v3 mobile-multi-select.svelte:548-551) and the desktop dropdown; an answer the filter removes
// is cleared and warned about before it erases a stored value ("Felder werden geleert", owner Q5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import '../components/ui/jsdom-shims.testing';
import type { Json, SessionOptions } from './contract';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
type Form = Parameters<typeof buildFormModel>[0]['form'];

const properties = {
  gruppe: P('select', { label: 'Gruppe', options: { laub: 'Laub', nadel: 'Nadel' } }),
  art: P('select', {
    label: 'Art',
    options: { eiche: 'Eiche', linde: 'Linde', kiefer: 'Kiefer' },
    option_hints: { linde: { de: 'Tilia cordata', en: 'Tilia cordata' } },
  }),
};
const form: Form = {
  gruppe: {},
  art: { choice_filter: "form.gruppe == 'laub' ? option != 'kiefer' : option == 'kiefer'" },
};
function session(self: Record<string, Json> = {}, extra: Partial<SessionOptions> = {}) {
  const input = { form, properties };
  return createFormSession(buildFormModel(input), sessionOptions(input, self, extra));
}

describe('session: choice_filter', () => {
  it('offers the filtered keys and follows the source answer', () => {
    const s = session({}, { initial: { gruppe: 'laub' } });
    expect(s.offered('art')).toEqual(['eiche', 'linde']);
    expect(s.offered('gruppe')).toBeUndefined();
    s.set('gruppe', 'nadel');
    expect(s.offered('art')).toEqual(['kiefer']);
  });

  it('a filtered select waits for its source field while that is empty (v3 smart_dropdown, WP-734)', () => {
    const s = session();
    expect(s.waitingForSource('art')).toBe(true);
    expect(s.waitingForSource('gruppe')).toBe(false);
    s.set('gruppe', 'laub');
    expect(s.waitingForSource('art')).toBe(false);
  });

  it('clears an answer the filter removes; a stored value it erases is warned about before the submit', () => {
    const s = session({ art: 'eiche' }, { initial: { gruppe: 'laub', art: 'eiche' } });
    expect(s.clearing()).toEqual([]);
    s.set('gruppe', 'nadel');
    expect(s.get('art')).toBeUndefined();
    expect(s.clearing().map((c) => c.key)).toEqual(['art']);
    expect(s.submitValuesCleared()).toMatchObject({ gruppe: 'nadel', art: null });
    expect(s.submitValues()).toEqual({ gruppe: 'nadel' });
  });

  it('a removed answer nothing stored holds is cleared without a warning', () => {
    const s = session({}, { initial: { gruppe: 'laub', art: 'eiche' } });
    s.set('gruppe', 'nadel');
    expect(s.get('art')).toBeUndefined();
    expect(s.clearing()).toEqual([]);
  });
});

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe.each([
  ['phone 390px', 390],
  ['desktop 1280px', 1280],
])('FormRenderer with a choice_filter at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  it('lists only the offered options, with the explanation text under its option', async () => {
    const user = userEvent.setup();
    render(FormRenderer, { session: session({}, { initial: { gruppe: 'laub' } }), onsubmit: vi.fn() });
    await user.click(screen.getAllByRole('button', { name: /Art/ })[0] as HTMLElement);
    expect(await screen.findByText('Eiche')).toBeTruthy();
    expect(screen.getByText('Linde')).toBeTruthy();
    expect(screen.getByText('Tilia cordata')).toBeTruthy();
    expect(screen.queryByText('Kiefer')).toBeNull();
  });

  it('the Felder-werden-geleert warning shows the removed field before a stored value is erased', async () => {
    const user = userEvent.setup();
    const s = session({ art: 'eiche' }, { initial: { gruppe: 'laub', art: 'eiche' } });
    const onsubmit = vi.fn();
    render(FormRenderer, { session: s, onsubmit });
    s.set('gruppe', 'nadel');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('alertdialog')).textContent).toContain('Art');
    expect(onsubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Clear & save' }));
    expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining({ gruppe: 'nadel', art: null }));
  });

  it('shows the dashed hint instead of the select while the source field is empty, and drops it once it is chosen', async () => {
    const s = session();
    render(FormRenderer, { session: s, onsubmit: vi.fn() });
    expect(screen.getByTestId('dependent-hint').textContent).toContain(
      'Select a value in the dependent field first',
    );
    s.set('gruppe', 'laub');
    await waitFor(() => expect(screen.queryByTestId('dependent-hint')).toBeNull());
    expect(screen.getAllByRole('button', { name: /Art/ }).length).toBeGreaterThan(0);
  });
});
