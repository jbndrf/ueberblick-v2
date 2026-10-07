// WP-414: a type whose only change is an order has no keep/move choice (an order touches no feature, as WP-411's `affected`).
import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Key, RunId, TemplateFile } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import { composeProjectStore } from '../http/shared/stores';
import { logSpy } from '../store/run/log.testkit';
import { deployProject, plan, type PinDeps } from './index';

const clock = { now: () => '2026-10-03T10:00:00Z' };
const ROOT: Actor = { id: 'root', kind: 'admin', roles: [] };
const perms = { see: '$all', create: '$all', write: '$all' };

interface Variant {
  readonly label?: string;
  readonly props?: readonly string[];
  readonly form?: readonly string[];
}
const file = ({ label = 'Baum', props = ['a', 'b'], form = ['a', 'b'] }: Variant = {}): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'pins', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      baum: {
        label,
        permissions: perms,
        properties: Object.fromEntries(props.map((p) => [p, { type: 'text' }])),
      },
    },
    tasks: {
      anlegen: {
        label: 'Anlegen',
        who: ['admin'],
        on: '$map',
        creates: 'baum',
        form: Object.fromEntries(form.map((p) => [p, {}])),
      },
    },
  }) as unknown as TemplateFile;

function world() {
  const db = openProjectDb(':memory:', 'p');
  const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
  let n = 0;
  const mint = (prefix: number) => `${prefix}0000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  const pins: PinDeps = { store, ids: { runId: () => mint(2) as RunId } };
  const deps = { clock, afterDeploy: () => undefined, pins };
  expect(deployProject(db, file(), 'root', deps).ok).toBe(true);
  const r = store.submit({
    id: mint(1) as RunId,
    task: 'anlegen' as Key,
    actor: ROOT,
    configVersion: 1,
    featureId: mint(0) as FeatureId,
    input: { a: 'x', b: 'y' },
  });
  expect(r.outcome).toBe('accepted');
  return { db, deps };
}

const typesOffered = (v: Variant): readonly string[] => {
  const w = world();
  const r = plan(w.db, file(v), w.deps);
  if (!r.ok) throw new Error('plan failed');
  return r.versions.map((p) => p.type);
};

describe('versionPlans and an order-only change (WP-414)', () => {
  it('offers keep / move for a type with another change', () => {
    expect(typesOffered({ label: 'Baum neu' })).toEqual(['baum']);
  });

  it('offers nothing when the type has only a property order change', () => {
    expect(typesOffered({ props: ['b', 'a'] })).toEqual([]);
  });

  it('offers nothing when only the form of a task on the type was reordered', () => {
    expect(typesOffered({ form: ['b', 'a'] })).toEqual([]);
  });

  it('offers when an order change comes with another change of the type', () => {
    expect(typesOffered({ props: ['b', 'a'], label: 'Baum neu' })).toEqual(['baum']);
  });
});
