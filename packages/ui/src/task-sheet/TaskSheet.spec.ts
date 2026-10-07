// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Key } from '@ueberblick/core/model';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from '../form/model';
import { evalContext, formWorld } from '../form/form.testing';
import { axeViolations } from '../testing/axe';
import { TARGET_SIZE } from '../tokens';
import Harness from './testing/Harness.svelte';
import { fakeIds, fakeSubmitter, fakeTimer, memoryDrafts } from './testing/ports';
import type { RunDraft, TaskSheetProps } from './contract';
import { DRAFT_SAVE_DELAY_MS, SubmitRefusedError } from './contract';

afterEach(cleanup);

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
const input = {
  form: { vitalitaet: { required: true }, befund: { relevant: 'form.vitalitaet >= 3' }, foto: {} },
  properties: {
    vitalitaet: P('integer', { label: 'Vitality' }),
    befund: P('text', { label: 'Finding' }),
    foto: P('file', { label: 'Photo' }),
  },
};
const model = buildFormModel(input);
const { config } = formWorld(input, 'kontrolle' as Key);
const ctx = evalContext(config);
const F1 = 'f1' as FeatureId;

function setup(over: Partial<TaskSheetProps> = {}, delay = 0) {
  const submitter = fakeSubmitter(delay);
  const drafts = memoryDrafts();
  const ids = fakeIds();
  const props = {
    taskKey: 'kontrolle',
    model,
    config,
    ctx,
    ids,
    submitter,
    drafts,
    online: false,
    featureIds: [F1],
    ...over,
  } as TaskSheetProps;
  const view = render(Harness, props);
  return { submitter, drafts, ids, view, user: userEvent.setup(), props };
}
const nth = (s: { submitted: RunDraft[] }, i: number): RunDraft => s.submitted[i] as RunDraft;
const ready = () => screen.findByLabelText(/Vitality/);

describe('submit', () => {
  it('creates exactly one run draft with a UUIDv7 id and only relevant values', async () => {
    const { submitter, ids, user } = setup();
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    const run = submitter.submitted[0] as RunDraft;
    expect(run.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids.minted()).toBe(1);
    expect(run).toMatchObject({ task: 'kontrolle', featureId: F1, input: { vitalitaet: 2 } });
    expect(Object.keys(run.input)).not.toContain('befund');
  });

  it('prunes a value that became non-relevant', async () => {
    const { submitter, user } = setup({ initial: { vitalitaet: 4, befund: 'x' } });
    await ready();
    const v = screen.getByLabelText(/Vitality/);
    await user.clear(v);
    await user.type(v, '1');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect(submitter.submitted[0]?.input).toEqual({ vitalitaet: 1 });
  });

  it('a double tap creates one run', async () => {
    const { submitter, ids, user } = setup({}, 30);
    await user.type(await ready(), '2');
    const submit = screen.getByRole('button', { name: 'Submit' });
    await Promise.all([user.click(submit), user.click(submit), user.dblClick(submit)]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/saved on this device/i));
    expect(submitter.submitted).toHaveLength(1);
    expect(ids.minted()).toBe(1);
  });

  it('several features (H2) give one run each, none gives one run without feature', async () => {
    const two = setup({ featureIds: ['a' as FeatureId, 'b' as FeatureId] });
    await two.user.type(await ready(), '2');
    await two.user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(two.submitter.submitted).toHaveLength(2));
    expect(two.submitter.submitted.map((r) => r.featureId)).toEqual(['a', 'b']);
    expect(new Set(two.submitter.submitted.map((r) => r.id)).size).toBe(2);
    cleanup();
    const none = setup({ featureIds: [] });
    await none.user.type(await ready(), '2');
    await none.user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(none.submitter.submitted).toHaveLength(1));
    expect('featureId' in (none.submitter.submitted[0] as RunDraft)).toBe(false);
  });

  it('a tool produces the value of its field', async () => {
    const { submitter, user } = setup();
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'use tool' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitter.submitted[0]?.input).toMatchObject({ foto: [{ sha256: 'IMG-1' }] }));
  });

  it('a failing store keeps the sheet open, allows a retry and reuses the run id', async () => {
    const { submitter, ids, user } = setup();
    const real = submitter.submit;
    let fail = true;
    submitter.submit = async (r) => {
      if (fail) throw new Error('disk full');
      return real(r);
    };
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be saved/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect(ids.minted()).toBe(1);
  });
});

describe('drafts', () => {
  it('closing with unsaved values keeps a draft; reopening restores it; submit drops it', async () => {
    const a = setup();
    await a.user.type(await ready(), '4');
    await a.user.type(screen.getByLabelText('Finding'), 'crown dry');
    cleanup();
    expect(a.drafts.map.get('kontrolle:f1')).toMatchObject({ vitalitaet: 4, befund: 'crown dry' });

    const b = setup({ drafts: a.drafts });
    expect(((await ready()) as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Finding') as HTMLInputElement).value).toBe('crown dry');
    expect(screen.getByText(/draft was restored/i)).toBeTruthy();
    await b.user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(b.submitter.submitted).toHaveLength(1));
    expect(a.drafts.map.has('kontrolle:f1')).toBe(false);
  });

  it('saves debounced while typing, without unmount; rapid changes coalesce; unchanged writes nothing', async () => {
    const timer = fakeTimer();
    const puts: unknown[] = [];
    const a = setup({ timer });
    const real = a.drafts.put;
    a.drafts.put = async (k, v) => {
      puts.push(v);
      return real(k, v);
    };
    const v = await ready();
    await a.user.type(v, '43');
    expect(puts).toHaveLength(0);
    expect(timer.pending()).toBe(1);
    timer.advance(DRAFT_SAVE_DELAY_MS);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(a.drafts.map.get('kontrolle:f1')).toMatchObject({ vitalitaet: 43 });
    // back to the saved value: nothing to write
    await a.user.type(v, '{Backspace}3');
    timer.advance(DRAFT_SAVE_DELAY_MS);
    expect(puts).toHaveLength(1);
    cleanup();
    expect(puts).toHaveLength(1);
  });

  it('a draft that cannot be kept (storage full) is shown, not swallowed', async () => {
    const timer = fakeTimer();
    const a = setup({ timer });
    a.drafts.put = async () => {
      throw new Error('quota');
    };
    await a.user.type(await ready(), '4');
    timer.advance(DRAFT_SAVE_DELAY_MS);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('a failing draft drop after a stored run still reaches sent', async () => {
    const a = setup();
    a.drafts.drop = async () => {
      throw new Error('idb closed');
    };
    await a.user.type(await ready(), '2');
    await a.user.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/saved on this device/i);
  });

  it('closing untouched keeps no draft', async () => {
    const a = setup();
    await ready();
    cleanup();
    expect(a.drafts.map.size).toBe(0);
  });

  it('each feature has its own draft unless a draftKey is given', async () => {
    const a = setup({ draftKey: 'custom' });
    await a.user.type(await ready(), '4');
    cleanup();
    expect([...a.drafts.map.keys()]).toEqual(['custom']);
  });
});

describe('honest outcome', () => {
  it('offline: says saved on this device, never done, until the server accepted', async () => {
    const { submitter, user } = setup({ online: false });
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/saved on this device.*will be sent/i);
    expect(status.textContent).not.toMatch(/done|accepted/i);
    submitter.push(nth(submitter, 0).id, { state: 'accepted' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/accepted by the server/i));
  });

  it('online but not yet accepted still is not done', async () => {
    const { user } = setup({ online: true });
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/saved on this device/i);
    expect(status.textContent).not.toMatch(/done|accepted/i);
  });

  it('a later refusal shows the reason and reopens the draft', async () => {
    const { submitter, drafts, user } = setup();
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('status');
    submitter.push(nth(submitter, 0).id, { state: 'refused', reason: 'not allowed in this stage' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/not allowed in this stage/);
    await user.click(screen.getByRole('button', { name: 'Reopen draft' }));
    expect(((await ready()) as HTMLInputElement).value).toBe('2');
    expect(drafts.map.get('kontrolle:f1')).toMatchObject({ vitalitaet: 2 });
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(2));
    expect(nth(submitter, 1).id).not.toBe(nth(submitter, 0).id);
  });
});

describe('a11y and layout', () => {
  it('has no axe violations while editing and after submit', async () => {
    const { container } = setup().view;
    await ready();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('primary action is 56 px and the keyboard submits', async () => {
    const { submitter, user } = setup();
    await user.type(await ready(), '2');
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit.style.minHeight).toBe(`${TARGET_SIZE.primary}px`);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
  });

  it('after submit the outcome is axe clean and Close calls onclose', async () => {
    let closed = 0;
    const { view, user } = setup({ onclose: () => void (closed += 1) });
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('status');
    expect(await axeViolations(view.container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(closed).toBe(1);
  });

  it('WP-788: the outcome block uses the app button (not the kit ub-button) and has side padding', async () => {
    const { user } = setup({ onclose: () => undefined });
    await user.type(await ready(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const outcome = await screen.findByRole('status');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.classList.contains('ub-button')).toBe(false);
    expect(close.dataset['slot']).toBe('button');
    expect(outcome.classList.contains('outcome')).toBe(true);
  });
});

describe('a submit that fails', () => {
  it('a refusal the submitter explains itself shows no generic save-failed line', async () => {
    const { submitter, user } = setup({ initial: { vitalitaet: 4 } });
    submitter.submit = async () => {
      throw new SubmitRefusedError('Nicht erlaubt.');
    };
    await ready();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a storage failure shows the generic line', async () => {
    const { submitter, user } = setup({ initial: { vitalitaet: 4 } });
    submitter.submit = async () => {
      throw new Error('disk full');
    };
    await ready();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
