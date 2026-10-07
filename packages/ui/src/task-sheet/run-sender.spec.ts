// The shared submit path of the task sheet and the multi-step flow (R1).
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key, RunId } from '@ueberblick/core/model';
import { createRunSender, summarize } from './run-sender';
import { SubmitRefusedError } from './contract';
import { fakeIds, fakeSubmitter } from './testing/ports';

const F1 = 'f1' as FeatureId;
const F2 = 'f2' as FeatureId;
const make = (featureIds: FeatureId[] | undefined) => {
  const submitter = fakeSubmitter();
  const sub = createRunSender({
    taskKey: 'aufgabe' as Key,
    ids: fakeIds(),
    submitter,
    featureIds: () => featureIds,
  });
  return { submitter, sub };
};

describe('createRunSender', () => {
  it('one run per target feature, with the input', async () => {
    const { submitter, sub } = make([F1, F2]);
    expect(await sub.submit({ a: 1 })).toEqual({ stored: true });
    expect(submitter.submitted.map((r) => [r.featureId, r.input])).toEqual([
      [F1, { a: 1 }],
      [F2, { a: 1 }],
    ]);
  });

  it('no feature: one run that creates one', async () => {
    const { submitter, sub } = make(undefined);
    await sub.submit({});
    expect(submitter.submitted).toHaveLength(1);
    expect(submitter.submitted[0]?.featureId).toBeUndefined();
  });

  it('a second tap while the first is running is ignored', async () => {
    const { submitter, sub } = make([F1]);
    const first = sub.submit({});
    expect(await sub.submit({})).toEqual({ stored: false, busy: true });
    await first;
    expect(submitter.submitted).toHaveLength(1);
  });

  it('a failed save frees the next try, which is the same run (idempotent)', async () => {
    const { submitter, sub } = make([F1]);
    const real = submitter.submit;
    let fail = true;
    submitter.submit = async (r) => {
      if (fail) throw new Error('disk full');
      return real(r);
    };
    expect(await sub.submit({})).toEqual({ stored: false, busy: false });
    const id = sub.runIds()?.[0];
    fail = false;
    expect(await sub.submit({})).toEqual({ stored: true });
    expect(sub.runIds()?.[0]).toBe(id);
  });

  it('a submitter that explains its refusal itself is told apart from a failed save', async () => {
    const { submitter, sub } = make([F1]);
    submitter.submit = async () => {
      throw new SubmitRefusedError('Nicht erlaubt.');
    };
    expect(await sub.submit({})).toEqual({ stored: false, busy: false, explained: true });
  });

  it('reset makes new runs next time', async () => {
    const { sub } = make([F1]);
    await sub.submit({});
    const id = sub.runIds()?.[0];
    sub.reset();
    await sub.submit({});
    expect(sub.runIds()?.[0]).not.toBe(id);
  });
});

describe('summarize', () => {
  const a = 'a' as RunId;
  const b = 'b' as RunId;
  it('accepted only when every run is', () => {
    expect(summarize({ a: { state: 'accepted' } }, [a, b]).accepted).toBe(false);
    expect(summarize({ a: { state: 'accepted' }, b: { state: 'accepted' } }, [a, b]).accepted).toBe(true);
  });
  it('a refusal wins and carries its reason', () => {
    const s = summarize({ a: { state: 'accepted' }, b: { state: 'refused', reason: 'zu kurz' } }, [a, b]);
    expect(s.refusal).toBe('zu kurz');
  });
});
