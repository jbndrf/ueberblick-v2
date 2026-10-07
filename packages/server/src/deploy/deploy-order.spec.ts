import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import { deploy, loadConfig, plan, versions } from './index';

const deps = { clock: { now: () => '2026-10-03T10:00:00Z' } };

const file = (props: Record<string, unknown>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'demo', version: '1.0.0' },
    types: { baum: { label: 'Baum', geometry: 'point', properties: props } },
    tasks: { melden: { label: 'Melden', on: 'baum', form: { art: {} } } },
  }) as unknown as TemplateFile;

const ab = { art: { type: 'text' }, vitalitaet: { type: 'integer', min: 0, max: 5 } };
const ba = { vitalitaet: ab.vitalitaet, art: ab.art };

describe('deploy: order is a change (A-042)', () => {
  it('an order-only draft is planned as one non-breaking entry and deploys a new version with the new order', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, file(ab), 'a', deps);
    const p = plan(db, file(ba), deps);
    if (!p.ok) throw new Error('expected ok');
    expect(p.diff).toMatchObject([
      { path: 'types.baum.properties', change: 'order_changed', breaking: false },
    ]);
    const r = deploy(db, file(ba), 'a', deps);
    if (!r.ok) throw new Error('expected ok');
    expect(r.created).toBe(true);
    expect(r.version).toBe(2);
    expect(versions(db).map((v) => v.status)).toEqual(['retired', 'deployed']);
    expect(Object.keys(loadConfig(db)?.file.types?.baum?.properties ?? {})).toEqual(['vitalitaet', 'art']);
  });

  it('the same order again creates no version', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, file(ba), 'a', deps);
    const again = deploy(db, file({ vitalitaet: ab.vitalitaet, art: ab.art }), 'a', deps);
    if (!again.ok) throw new Error('expected ok');
    expect(again.created).toBe(false);
    expect(again.diff).toEqual([]);
    expect(versions(db)).toHaveLength(1);
  });
});
