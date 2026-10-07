// @vitest-environment jsdom
// WP-439: v3's "Regex Pattern" (text) and "Step" (number) in the field panel's validation, as parts of the form entry's
// constraint (`matches`, `%`): they round-trip through the file, an invalid pattern shows its problem and writes nothing,
// a decimal field gets a hint instead of a step, and the participant's form refuses a value that breaks them.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Doc, Op } from '../../doc';
import { buildPreview } from '../../lenses/task/preview';
import { messages } from '../../shell/messages';
import { TASK, TYPE, clean, openEditor, reloaded, stubBrowser } from './editor.testing';
import { rulesOps } from './config';
import { newFieldOps } from './ops';
import { PALETTE_TILES } from './palette';

beforeAll(stubBrowser);
afterEach(cleanup);
const user = userEvent.setup({ pointerEventsCheck: 0 });

const typeInto = async (el: HTMLElement, text: string): Promise<void> => {
  await user.clear(el);
  if (text !== '') {
    await user.click(el);
    await user.paste(text);
  }
  await user.tab();
};

/** The golden project with a whole-number field `stueckzahl` in the form of `kontrolle`. */
function withInteger(): Doc {
  let doc = clean();
  const number = PALETTE_TILES.find((x) => x.key === 'number');
  if (number === undefined) throw new Error('no tile');
  const made = newFieldOps(doc, TASK, TYPE, { ...number, type: 'integer' }, 'Stueckzahl', 'de', {
    kind: 'page',
    page: 0,
  });
  for (const op of made.ops as readonly Op[]) doc = doc.apply(op).doc;
  return doc;
}
const INT = 'stueckzahl';
const TEXT = 'neues_feld';

/** The form editor with a fresh short text (`TEXT`) added by its tile; `doc` is the project to start from. */
async function openWithText(doc: Doc = clean()) {
  const h = await openEditor(doc);
  await user.click(screen.getByTestId('tile-short_text'));
  return h;
}

describe('Regex-Muster of a text', () => {
  it('writes matches() with a message, and reads it back after a reload', async () => {
    const h = await openWithText();
    await h.select(TEXT);
    await typeInto(screen.getByTestId('cfg-pattern'), '^[A-Z]{2}-\\d+$');
    expect(h.entry(TEXT)?.constraint).toBe("matches(value, '^[A-Z]{2}-\\\\d+$')");
    expect(h.entry(TEXT)?.constraint_message).toEqual({ de: 'Der Wert passt nicht zum Muster' });
    const again = await (async () => {
      cleanup();
      const r = await openEditor(reloaded(h.last()));
      await r.select(TEXT);
      return r;
    })();
    expect((screen.getByTestId('cfg-pattern') as HTMLInputElement).value).toBe('^[A-Z]{2}-\\d+$');
    expect(again.entry(TEXT)?.constraint).toBe("matches(value, '^[A-Z]{2}-\\\\d+$')");
  });

  it('combines with the length limits; emptying the input removes only the pattern', async () => {
    const h = await openWithText();
    await h.select(TEXT);
    await typeInto(screen.getByTestId('cfg-min'), '2');
    await typeInto(screen.getByTestId('cfg-pattern'), '^a');
    expect(h.entry(TEXT)?.constraint).toBe("size(value) >= 2 && matches(value, '^a')");
    await typeInto(screen.getByTestId('cfg-pattern'), '');
    expect(h.entry(TEXT)?.constraint).toBe('size(value) >= 2');
  });

  it('a pattern outside the subset shows the problem in place and writes nothing', async () => {
    const h = await openWithText();
    await h.select(TEXT);
    await typeInto(screen.getByTestId('cfg-pattern'), '(?=a)b');
    expect(screen.getByTestId('cfg-pattern-error').textContent).toContain('Vor- oder Rückblick');
    expect(h.entry(TEXT)?.constraint).toBeUndefined();
    await typeInto(screen.getByTestId('cfg-pattern'), '(a');
    expect(screen.getByTestId('cfg-pattern-error').textContent).toContain('nicht geschlossen');
    expect(h.entry(TEXT)?.constraint).toBeUndefined();
    await typeInto(screen.getByTestId('cfg-pattern'), '^a$');
    expect(screen.queryByTestId('cfg-pattern-error')).toBeNull();
    expect(h.entry(TEXT)?.constraint).toBe("matches(value, '^a$')");
  });

  it('a constraint of its own keeps the pattern input away', async () => {
    const h = await openEditor();
    await h.select('befund');
    expect(screen.getByTestId('cfg-foreign')).toBeTruthy();
    expect(screen.queryByTestId('cfg-pattern')).toBeNull();
  });
});

describe('Schritt of a whole number', () => {
  it('writes a remainder rule with a message, and reads it back after a reload', async () => {
    const h = await openEditor(withInteger());
    await h.select(INT);
    expect(screen.queryByTestId('cfg-pattern')).toBeNull();
    await typeInto(screen.getByTestId('cfg-step'), '5');
    expect(h.entry(INT)?.constraint).toBe('multiple_of(value, 5)');
    expect(h.entry(INT)?.constraint_message).toEqual({ de: 'Der Wert muss ein Vielfaches von 5 sein' });
    cleanup();
    const again = await openEditor(reloaded(h.last()));
    await again.select(INT);
    expect((screen.getByTestId('cfg-step') as HTMLInputElement).value).toBe('5');
    await typeInto(screen.getByTestId('cfg-step'), '');
    expect(again.entry(INT)?.constraint).toBeUndefined();
  });

  it('a step that is not a whole number of at least 1 shows an error and writes nothing', async () => {
    const h = await openEditor(withInteger());
    await h.select(INT);
    await typeInto(screen.getByTestId('cfg-step'), '0.5');
    expect(screen.getByTestId('cfg-step-error').textContent).toContain('ganze Zahl ab 1');
    expect(h.entry(INT)?.constraint).toBeUndefined();
    await typeInto(screen.getByTestId('cfg-step'), '0');
    expect(screen.getByTestId('cfg-step-error')).toBeTruthy();
    expect(h.entry(INT)?.constraint).toBeUndefined();
  });

  it('a decimal field has a step too (v3 FieldConfigPanel.svelte:781-786): 0.5 is written exactly and read back', async () => {
    const h = await openEditor();
    await user.click(screen.getByTestId('tile-number'));
    await h.select('neues_feld');
    await typeInto(screen.getByTestId('cfg-step'), '0.5');
    expect(h.entry('neues_feld')?.constraint).toBe('multiple_of(value, 0.5)');
    expect(h.entry('neues_feld')?.constraint_message).toEqual({
      de: 'Der Wert muss ein Vielfaches von 0.5 sein',
    });
    cleanup();
    const again = await openEditor(reloaded(h.last()));
    await again.select('neues_feld');
    expect((screen.getByTestId('cfg-step') as HTMLInputElement).value).toBe('0.5');
    await typeInto(screen.getByTestId('cfg-step'), '0');
    expect(screen.getByTestId('cfg-step-error').textContent).toContain('über 0');
    await typeInto(screen.getByTestId('cfg-step'), '0.0000000001');
    expect(screen.getByTestId('cfg-step-error')).toBeTruthy();
  });
});

describe("the participant's form refuses what breaks the pattern or the step", () => {
  it('through the existing form validation, with the constraint message', async () => {
    const t = messages('de');
    let doc = withInteger();
    const short = PALETTE_TILES.find((x) => x.key === 'short_text');
    if (short === undefined) throw new Error('no tile');
    const made = newFieldOps(doc, TASK, TYPE, short, 'Neues Feld', 'de', { kind: 'page', page: 0 });
    for (const op of made.ops) doc = doc.apply(op).doc;
    for (const [key, patch] of [
      [TEXT, { pattern: '^[A-Z]{2}$' }],
      [INT, { step: 5 }],
    ] as const)
      for (const op of rulesOps(doc, TASK, key, TYPE, patch, 'de', t)) doc = doc.apply(op).doc;
    const file = doc.effective();
    const built = buildPreview(file, TASK, 'kontrolle', 'de');
    if (!built.ok) throw new Error(built.reason);
    const s = built.session;
    s.set(TEXT, 'ab1');
    s.set(INT, 7);
    const faults = s.validateAll().filter((i) => i.fieldKey === TEXT || i.fieldKey === INT);
    expect(faults.map((i) => [i.fieldKey, i.kind, i.message]).sort()).toEqual([
      [TEXT, 'constraint', 'Der Wert passt nicht zum Muster'],
      [INT, 'constraint', 'Der Wert muss ein Vielfaches von 5 sein'],
    ]);
    s.set(TEXT, 'AB');
    s.set(INT, 10);
    expect(s.validateAll().filter((i) => i.fieldKey === TEXT || i.fieldKey === INT)).toEqual([]);
  });
});
