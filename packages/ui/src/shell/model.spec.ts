import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TemplateFile } from '@ueberblick/core/model';
import { deriveShellModel, deriveStatusKind, navDepth, stepsFrom } from './model';
import type { ShellInput } from './contract';

/** A role app list as a keyed map (A-005). */
const keyed = (keys: readonly string[]): Record<string, Record<string, never>> =>
  Object.fromEntries(keys.map((k) => [k, {}]));

function file(roles: TemplateFile['roles']): TemplateFile {
  return {
    schema: '1',
    template: { key: 't', version: '1.0.0' },
    roles,
    views: {
      alle: { label: { de: 'Alle', en: 'All' } },
      mein: { label: 'Meine' },
      archiv: {},
    },
    tools: { photo: {}, measure: {}, gps: {} },
    tasks: {
      kontrolle: { label: { de: 'Kontrolle', en: 'Inspection' }, on: { create: 'baum' } },
      melden: { label: 'Melden', on: { create: 'schaden' } },
      fallen: { label: 'Fällen', on: { create: 'baum' } },
    },
  } as unknown as TemplateFile;
}

const roles: TemplateFile['roles'] = {
  worker: {
    label: 'Worker',
    app: {
      home: 'mein',
      views: keyed(['mein', 'alle', 'ghost']),
      tools: keyed(['photo', 'ghost']),
      shortcuts: keyed(['kontrolle', 'nope']),
    },
  },
  plain: { label: 'Plain' },
  outdoor: { label: 'Outdoor', app: { ui: { theme: 'outdoor' } } },
};

const input = (over: Partial<ShellInput> = {}): ShellInput => ({
  file: file(roles),
  roleKey: 'worker',
  locale: 'en',
  ...over,
});

describe('deriveShellModel', () => {
  it('shows a role only its views, tools and shortcuts (unknown keys dropped)', () => {
    const m = deriveShellModel(input());
    expect(m.views.map((v) => v.key)).toEqual(['mein', 'alle']);
    expect(m.home).toBe('mein');
    expect(m.tools.map((t) => t.key)).toEqual(['photo']);
    expect(m.graph.nodes.some((n) => n.id === 'tool:ghost')).toBe(false);
    expect(m.shortcuts.map((s) => s.key)).toEqual(['kontrolle']);
  });

  it('resolves localized labels by locale, falling back to the first language', () => {
    expect(deriveShellModel(input({ locale: 'de' })).views[1]?.label).toBe('Alle');
    expect(deriveShellModel(input({ locale: 'en' })).views[1]?.label).toBe('All');
    expect(deriveShellModel(input({ locale: 'fr' })).views[1]?.label).toBe('Alle');
    expect(deriveShellModel(input()).views[0]?.label).toBe('Meine');
  });

  it('gives a role without an app profile the documented defaults', () => {
    const m = deriveShellModel(input({ roleKey: 'plain' }));
    expect(m.views.map((v) => v.key)).toEqual(['alle', 'mein', 'archiv']);
    expect(m.home).toBe('alle');
    expect(m.tools.map((t) => t.key)).toEqual(['photo', 'measure', 'gps']);
    expect(m.shortcuts).toEqual([]);
    expect(m.theme).toBe('normal');
  });

  it('falls back to the first view when home is not among the views, and to null with no views', () => {
    const f = file({
      r: { label: 'R', app: { home: 'archiv', views: keyed(['alle']) } },
      e: { label: 'E', app: { views: {} } },
    });
    expect(deriveShellModel({ file: f, roleKey: 'r', locale: 'en' }).home).toBe('alle');
    expect(deriveShellModel({ file: f, roleKey: 'e', locale: 'en' }).home).toBeNull();
  });

  it('offers only allowed tasks in the picker; shortcuts must be allowed too', () => {
    const m = deriveShellModel(input({ allowedTasks: ['melden'] }));
    expect(m.tasks.map((t) => t.key)).toEqual(['melden']);
    expect(m.shortcuts).toEqual([]);
    expect(deriveShellModel(input()).tasks.map((t) => t.key)).toEqual(['kontrolle', 'melden', 'fallen']);
  });

  it('theme: user setting wins over the role ui.theme, which wins over normal', () => {
    expect(deriveShellModel(input({ roleKey: 'outdoor' })).theme).toBe('outdoor');
    expect(deriveShellModel(input({ roleKey: 'outdoor', userTheme: 'normal' })).theme).toBe('normal');
    expect(deriveShellModel(input({ userTheme: 'outdoor' })).theme).toBe('outdoor');
    expect(deriveShellModel(input()).theme).toBe('normal');
  });

  it('two roles of one project get different apps (H3)', () => {
    const a = deriveShellModel(input());
    const b = deriveShellModel(input({ roleKey: 'plain' }));
    expect(a.views).not.toEqual(b.views);
  });
});

describe('navigation graph', () => {
  const m = deriveShellModel(input());
  const steps = stepsFrom(m.graph, m.graph.start);

  it('a shortcut opens its task in 1 tap from home', () => {
    expect(steps.get('task:kontrolle')).toBe(1);
  });

  it('every function is at most 3 steps from home', () => {
    for (const n of m.graph.nodes) expect(steps.get(n.id), n.id).toBeLessThanOrEqual(3);
    expect(steps.size).toBe(m.graph.nodes.length);
  });

  it('a task that is not a shortcut takes 2 taps: "+", then the task', () => {
    expect(steps.get('new')).toBe(1);
    expect(steps.get('task:melden')).toBe(2);
  });

  it('the status details are 1 tap from every area', () => {
    for (const from of ['map', 'me']) expect(stepsFrom(m.graph, from).get('status')).toBe(1);
  });

  it('has at most two navigation levels', () => {
    expect(navDepth(m.graph)).toBeLessThanOrEqual(2);
    expect(Math.max(...m.graph.nodes.map((n) => n.level))).toBe(2);
  });

  it('sheets are not levels', () => {
    for (const n of m.graph.nodes.filter((x) => x.kind === 'sheet')) expect(n.level).toBe(0);
  });

  it('property: any profile keeps depth <= 2 and every function <= 3 steps', () => {
    fc.assert(
      fc.property(
        fc.subarray(['alle', 'mein', 'archiv']),
        fc.subarray(['photo', 'measure', 'gps']),
        fc.subarray(['kontrolle', 'melden', 'fallen']),
        (views, tools, shortcuts) => {
          const f = file({
            r: { label: 'R', app: { views: keyed(views), tools: keyed(tools), shortcuts: keyed(shortcuts) } },
          });
          const g = deriveShellModel({ file: f, roleKey: 'r', locale: 'en' }).graph;
          const s = stepsFrom(g, g.start);
          expect(navDepth(g)).toBeLessThanOrEqual(2);
          for (const n of g.nodes) expect(s.get(n.id)).toBeLessThanOrEqual(3);
        },
      ),
    );
  });
});

describe('deriveStatusKind', () => {
  const base = {
    online: true,
    lastSyncedAt: null,
    pending: 0,
    oldestPendingAge: null,
    refused: [],
    storage: 'ok',
  } as const;
  it('most urgent first: refused, offline, pending, online', () => {
    expect(
      deriveStatusKind({ ...base, refused: [{ runId: 'r', reason: 'x' }], online: false, pending: 2 }),
    ).toBe('refused');
    expect(deriveStatusKind({ ...base, online: false, pending: 2 })).toBe('offline');
    expect(deriveStatusKind({ ...base, pending: 2 })).toBe('pending');
    expect(deriveStatusKind(base)).toBe('online');
  });
});
