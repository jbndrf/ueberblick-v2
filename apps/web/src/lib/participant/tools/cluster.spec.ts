import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createPrefsClient,
  type KeyValueStorage,
  type PrefsClient,
  type PrefsTransport,
} from '@ueberblick/client';
import type { TemplateFile } from '@ueberblick/core/model';
import { toolEntries } from './entries';
import {
  CLUSTER_TOOL,
  DEFAULT_CAP,
  clusterPrefs,
  parseCap,
  statsMessage,
  unclusterCap,
  writeCap,
  writeUncluster,
} from './cluster';

const file = (tools: Record<string, unknown>) =>
  ({
    roles: { k: { label: 'K', app: {} } },
    tools,
  }) as unknown as TemplateFile;

describe('parseCap: v3 handleCapInput', () => {
  it('takes a positive whole number', () => {
    expect(parseCap('250')).toBe(250);
    expect(parseCap('1')).toBe(1);
    expect(parseCap('50.9')).toBe(50); // v3 parseInt
  });
  it('ignores empty, zero, negative and non-numbers', () => {
    for (const raw of ['', '0', '-5', 'abc', ' ', 'NaN'] as const) expect(parseCap(raw)).toBeUndefined();
  });
  it('property: a result is always a positive safe integer', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const n = parseCap(raw);
        if (n !== undefined) {
          expect(Number.isSafeInteger(n)).toBe(true);
          expect(n).toBeGreaterThan(0);
        }
      }),
    );
  });
});

describe('clusterPrefs and unclusterCap', () => {
  it('defaults: off, cap 500', () => {
    expect(clusterPrefs(undefined)).toEqual({ uncluster: false, cap: DEFAULT_CAP });
    expect(DEFAULT_CAP).toBe(500);
  });
  it('reads what the person set and ignores wrong types', () => {
    expect(clusterPrefs({ uncluster: true, cap: 120 })).toEqual({ uncluster: true, cap: 120 });
    expect(clusterPrefs({ uncluster: 'yes', cap: -3 })).toEqual({ uncluster: false, cap: DEFAULT_CAP });
  });
  it('the map is told a cap only while the tool is on AND the switch is on', () => {
    const on = toolEntries(file({ cluster: {} }), 'k', {});
    const off = toolEntries(file({ cluster: {} }), 'k', { cluster: false });
    const prefs = { uncluster: true, cap: 80 };
    expect(unclusterCap(on, prefs)).toBe(80);
    expect(unclusterCap(off, prefs)).toBeNull();
    expect(unclusterCap(on, { uncluster: false, cap: 80 })).toBeNull();
    expect(unclusterCap([], prefs)).toBeNull();
  });
});

describe('statsMessage: the stats line', () => {
  it('names the count singly drawn, or too many', () => {
    expect(statsMessage({ inView: 12, single: true })).toEqual({ key: 'filter_cluster_showing', count: 12 });
    expect(statsMessage({ inView: 900, single: false })).toEqual({
      key: 'filter_cluster_too_many',
      count: 900,
    });
  });
  it('says nothing when there is nothing in view (v3 hides the line)', () => {
    expect(statsMessage({ inView: 0, single: false })).toBeUndefined();
    expect(statsMessage(undefined)).toBeUndefined();
  });
});

describe('writes go to the personal preference record', () => {
  it('the switch and the cap are tool_prefs.cluster.*', () => {
    const calls: [string, unknown][] = [];
    const person = { setPreference: (k: string, n: string, v: unknown) => calls.push([`${k}.${n}`, v]) };
    writeUncluster(person, true);
    writeCap(person, 250);
    expect(CLUSTER_TOOL).toBe('cluster');
    expect(calls).toEqual([
      ['cluster.uncluster', true],
      ['cluster.cap', 250],
    ]);
  });
  it('are accepted by the record (key paths valid) and survive a reload, offline', () => {
    const m = new Map<string, string>();
    const storage: KeyValueStorage = {
      get: (k) => m.get(k) ?? null,
      set: (k, v) => void m.set(k, v),
      remove: (k) => void m.delete(k),
    };
    const offline: PrefsTransport = {
      fetch: () => Promise.reject(new Error('offline')),
      send: () => Promise.reject(new Error('offline')),
    };
    let t = 0;
    const clock = { now: () => new Date(Date.UTC(2026, 9, 2, 12, 0, 0, t++)).toISOString() };
    const make = (): PrefsClient =>
      createPrefsClient({ storage, transport: offline, clock, project: 'p', participant: 'u' });
    const a = make();
    a.set('tool_prefs.cluster.uncluster', true);
    a.set('tool_prefs.cluster.cap', 250);
    expect(clusterPrefs(make().current().tool_prefs['cluster'])).toEqual({ uncluster: true, cap: 250 });
  });
});
