// WP-680: the id of the feature a create run makes is minted before the run is submitted (the plan takes it from the
// run for `on: $map` tasks), so the form knows what to open once the run is accepted, with no second lookup.
import { describe, expect, it, vi } from 'vitest';
import type { RunDraft, RunSubmitter } from '@ueberblick/ui';
import type { FeatureId, RunId } from '@ueberblick/core/model';
import type { TemplateFile } from '@ueberblick/core/schema';
import { createsOffMap, createsOnMap, mintNewFeatureId, reportCreated } from './new-feature';

const file = {
  tasks: {
    erfassen: { on: '$map', creates: 'baum' },
    anlegen: { on: '$none', creates: 'baumart' },
    pruefen: { on: 'baum' },
  },
} as unknown as TemplateFile;

describe('createsOnMap', () => {
  it('is true only for a task that creates a feature on the map', () => {
    expect(createsOnMap(file, 'erfassen')).toBe(true);
    expect(createsOnMap(file, 'anlegen')).toBe(false);
    expect(createsOnMap(file, 'pruefen')).toBe(false);
    expect(createsOnMap(file, 'missing')).toBe(false);
  });
});

describe('mintNewFeatureId', () => {
  const draft = (id: string): RunDraft => ({ id: id as RunId, task: 'erfassen' as never, input: {} });
  const setup = (enabled: boolean) => {
    const submit = vi.fn<RunSubmitter['submit']>(async () => 'queued');
    const inner: RunSubmitter = { submit, outcome: () => () => undefined };
    let n = 0;
    const ids = { featureId: () => `f${++n}` as FeatureId };
    return { submit, minted: mintNewFeatureId(inner, ids, enabled) };
  };

  it('puts the minted id on the run and remembers it', async () => {
    const { submit, minted } = setup(true);
    await minted.submit(draft('r1'));
    expect(submit.mock.calls[0]?.[0].featureId).toBe('f1');
    expect(minted.created()).toBe('f1');
  });

  it('a retry (a new run) is a new feature id; the last one counts', async () => {
    const { minted } = setup(true);
    await minted.submit(draft('r1'));
    await minted.submit(draft('r2'));
    expect(minted.created()).toBe('f2');
  });

  it('disabled: the run goes through unchanged and no id is known', async () => {
    const { submit, minted } = setup(false);
    await minted.submit(draft('r1'));
    expect(submit.mock.calls[0]?.[0]).toEqual(draft('r1'));
    expect(minted.created()).toBeUndefined();
  });

  it('a failed store forgets the id', async () => {
    const inner: RunSubmitter = {
      submit: async () => {
        throw new Error('quota');
      },
      outcome: () => () => undefined,
    };
    const minted = mintNewFeatureId(inner, { featureId: () => 'f1' as FeatureId }, true);
    await expect(minted.submit(draft('r1'))).rejects.toThrow();
    expect(minted.created()).toBeUndefined();
  });
});

describe('createsOffMap', () => {
  it('is true for a task that creates a feature without a map position only', () => {
    expect(createsOffMap(file, 'anlegen')).toBe(true);
    expect(createsOffMap(file, 'erfassen')).toBe(false);
    expect(createsOffMap(file, 'pruefen')).toBe(false);
  });
});

describe('reportCreated (WP-681)', () => {
  const draft = (id: string): RunDraft => ({ id: id as RunId, task: 'anlegen' as never, input: {} });
  const setup = (enabled: boolean, answers: Record<string, FeatureId[]>) => {
    const inner = { submit: async () => 'queued' as const, outcome: () => () => undefined };
    const ids = { featureId: () => 'minted' as FeatureId };
    const asked: string[] = [];
    const s = reportCreated(
      mintNewFeatureId(inner, ids, false),
      (r) => (asked.push(r), answers[r] ?? []),
      enabled,
    );
    return { s, asked };
  };

  it('answers with the first feature the queue says the last run created', async () => {
    const { s } = setup(true, { r2: ['f9' as FeatureId, 'f10' as FeatureId] });
    await s.submit(draft('r1')); // a refused first try
    await s.submit(draft('r2'));
    expect(s.created()).toBe('f9');
  });

  it('is undefined when the plan created nothing, or before a submit', async () => {
    const { s } = setup(true, {});
    expect(s.created()).toBeUndefined();
    await s.submit(draft('r1'));
    expect(s.created()).toBeUndefined();
  });

  it('asks nothing when disabled; a minted id wins', async () => {
    const off = setup(false, { r1: ['f1' as FeatureId] });
    await off.s.submit(draft('r1'));
    expect(off.s.created()).toBeUndefined();
    expect(off.asked).toEqual([]);
  });

  it('forgets a run whose submit threw', async () => {
    const inner = { submit: () => Promise.reject(new Error('x')), outcome: () => () => undefined };
    const s = reportCreated(
      mintNewFeatureId(inner, { featureId: () => 'm' as FeatureId }, false),
      () => ['f1' as FeatureId],
      true,
    );
    await expect(s.submit(draft('r1'))).rejects.toThrow();
    expect(s.created()).toBeUndefined();
  });
});
