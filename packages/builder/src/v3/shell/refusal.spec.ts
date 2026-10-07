import { describe, expect, it } from 'vitest';
import { REFUSAL_CODES, openProject, type Doc, type Refusal } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { messages } from '../../shell/messages';
import { refusalText } from './refusal';

/** WP-518: a refusal says why, in the admin's language; the engine's English never reaches the screen. */
const doc = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const free = { kind: 'add', path: 'tasks.x', value: {} } as const;
const refusalOf = (op: Parameters<Doc['apply']>[0]): Refusal => {
  const r = doc().apply(op).refused;
  if (r === undefined) throw new Error('expected a refusal');
  return r;
};

describe('refusal reasons (WP-518)', () => {
  it.each(['de', 'en'])('every registry code has a wording in %s', (locale) => {
    const t = messages(locale);
    for (const code of REFUSAL_CODES) {
      const text = t(`refusal_${code}`, { path: 'a.b', shown: 'a.b' });
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('refusal_');
    }
  });

  it('a refusal that carries a checker problem shows its German text', () => {
    const op = { kind: 'set', path: 'tasks.kontrolle.button', value: { color: 'pink' } } as const;
    const r = refusalOf(op);
    expect(r.code).toBe('schema');
    expect(refusalText(messages('de'), doc(), [op], r, 'de')).toMatch(
      /^Nicht übernommen: Die Datei passt nicht zum Schema/,
    );
  });

  it('a scalar above names the entry, in German and English', () => {
    const d = doc().apply({ kind: 'set', path: 'types.baum.label', value: 'X' }).doc;
    const op = { kind: 'set', path: 'types.baum.label.de', value: 'Y' } as const;
    const r = d.apply(op).refused;
    expect(r?.code).toBe('scalar_above');
    expect(refusalText(messages('de'), d, [op], r)).toContain('types.baum.label');
    expect(refusalText(messages('de'), d, [op], r)).not.toContain('earlier edit');
    expect(refusalText(messages('en'), d, [op], r)).toContain('Reset it first');
  });

  it('a bad path is worded from its code, never from the engine message', () => {
    const r = refusalOf({ kind: 'set', path: 'Types..bad', value: 1 });
    expect(r.code).toBe('bad_path');
    const text = refusalText(messages('de'), doc(), [], r);
    expect(text).toContain('Types..bad');
    expect(text).not.toContain(r.message);
  });

  it('an unknown code or no refusal gives the generic line', () => {
    const t = messages('de');
    const odd = { path: '', message: 'English engine text', code: 'nope' } as unknown as Refusal;
    expect(refusalText(t, doc(), [free], odd)).toBe('Das ist nicht möglich.');
    expect(refusalText(t, doc(), [free])).toBe('Das ist nicht möglich.');
  });

  it('a locked path still says it is locked by the template', () => {
    const op = { kind: 'set', path: 'types.baum.properties.stage.options', value: [] } as const;
    const r = doc().apply(op).refused;
    expect(refusalText(messages('de'), doc(), [op], r)).toBe('Von der Vorlage gesperrt');
  });
});
