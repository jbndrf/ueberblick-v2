import { describe, expect, it, vi } from 'vitest';
import type { TemplateFile } from '@ueberblick/core/model';
import { createPrefsClient, type KeyValueStorage, type PrefsTransport } from '@ueberblick/client';
import { createToolPerson } from './person';

const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
};
const offline: PrefsTransport = {
  fetch: () => Promise.reject(new Error('offline')),
  send: () => Promise.reject(new Error('offline')),
};
let t = 0;
const clock = { now: () => new Date(Date.UTC(2026, 9, 1, 12, 0, 0, t++)).toISOString() };

const file = {
  roles: {
    kontrolle: {
      label: 'K',
      app: {
        tools: {
          measure: { availability: 'offered', settings: { units: 'm' } },
          search: { availability: 'active' },
        },
      },
    },
  },
  tools: { measure: { precision: 2 }, search: { sources: ['baum.art'] } },
} as unknown as TemplateFile;

function person(flush?: () => void) {
  const prefs = createPrefsClient({
    storage: memory(),
    transport: offline,
    clock,
    project: 'p',
    participant: 'u',
  });
  return {
    prefs,
    person: createToolPerson({
      file,
      roleKey: 'kontrolle',
      prefs,
      ...(flush === undefined ? {} : { flush }),
    }),
  };
}

describe('the person port over the preference client', () => {
  it('answers availability and settings from the project file and the role', () => {
    const { person: p } = person();
    expect(p.availability('measure')).toBe('offered');
    expect(p.availability('nope')).toBeUndefined();
    expect(p.settings('measure')).toEqual({ project: { precision: 2 }, role: { units: 'm' } });
  });

  it('a switch is stored in the record as tools.<key> and read back, offline', () => {
    const { prefs, person: p } = person();
    expect(p.switchOf('measure')).toBeUndefined();
    p.setSwitch('measure', true);
    expect(prefs.current().tools).toEqual({ measure: true });
    expect(p.switchOf('measure')).toBe(true);
    expect(prefs.pending().map((e) => e.path)).toEqual(['tools.measure']);
  });

  it('tool preferences go to tool_prefs.<tool>.<key>', () => {
    const { prefs, person: p } = person();
    p.setPreference('search', 'fields', ['a']);
    expect(prefs.current().tool_prefs).toEqual({ search: { fields: ['a'] } });
    expect(p.preferencesOf('search')).toEqual({ fields: ['a'] });
  });

  it('tells its listeners when the record changes', () => {
    const { person: p } = person();
    let n = 0;
    const stop = p.subscribe(() => n++);
    p.setSwitch('search', false);
    stop();
    p.setSwitch('search', true);
    expect(n).toBe(1);
  });

  it('asks the app to send after each edit', () => {
    const flush = vi.fn();
    const { person: p } = person(flush);
    p.setSwitch('measure', true);
    p.setPreference('search', 'fields', []);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('the record the switches read is the whole map of tool switches', () => {
    const { person: p } = person();
    p.setSwitch('search', false);
    expect(p.switches()).toEqual({ search: false });
  });
});
