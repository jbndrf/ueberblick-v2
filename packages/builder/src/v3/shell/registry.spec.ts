import { describe, expect, it } from 'vitest';
import { createBuilderRegistry, DEFAULT_VIEW, parseView, withView } from './registry';
import { selectionForPath } from './selection';

describe('view in the address', () => {
  it('parses a known view and falls back to the default', () => {
    expect(parseView('model')).toBe('model');
    expect(parseView('code')).toBe('code');
    expect(parseView('nope')).toBe(DEFAULT_VIEW);
    expect(parseView(null)).toBe(DEFAULT_VIEW);
  });

  it('writes ?view= and keeps other parameters', () => {
    expect(withView('', 'code')).toBe('?view=code');
    expect(withView('?focus=x&view=model', 'workflow')).toBe('?focus=x&view=workflow');
  });
});

describe('registry', () => {
  it('stays empty until something registers; the first focus hook that answers wins', () => {
    const r = createBuilderRegistry();
    expect(r.view('workflow')).toBeUndefined();
    expect(r.inspector('task')).toBeUndefined();
    const calls: string[] = [];
    r.registerFocus(() => (calls.push('a'), false));
    r.registerFocus(() => (calls.push('b'), true));
    r.registerFocus(() => (calls.push('c'), true));
    const item = { id: '0', path: 'tasks.x', code: 'x', message: '', location: {} } as never;
    expect(r.focus(item, {} as never)).toBe(true);
    expect(calls).toEqual(['a', 'b']);
  });
});

describe('selectionForPath', () => {
  it('names the entity a key path points into', () => {
    expect(selectionForPath('baum', 'tasks.kontrolle.form.befund')).toEqual({
      kind: 'task',
      id: 'kontrolle',
    });
    expect(selectionForPath('baum', 'rules.r1.when')).toEqual({ kind: 'rule', id: 'r1' });
    expect(selectionForPath('baum', 'types.baum.properties.art.label')).toEqual({ kind: 'field', id: 'art' });
    expect(selectionForPath('baum', 'types.baum')).toEqual({ kind: 'type', id: 'baum' });
    expect(selectionForPath('baum', 'roles.admin')).toEqual({ kind: 'none' });
  });
});
