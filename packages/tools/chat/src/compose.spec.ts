import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { activeMentionTrigger, appendSeed, bodyOf, insertPerson, isSendKey } from './compose';

describe('insertPerson (v3 Composer.svelte:65-99)', () => {
  it('goes in at the caret after a space when a word would touch it', () => {
    expect(insertPerson('Hallo', 5, 'anna-1')).toEqual({ value: 'Hallo @anna-1 ', caret: 14 });
    expect(insertPerson('Hallo ', 6, 'anna-1')).toEqual({ value: 'Hallo @anna-1 ', caret: 14 });
    expect(insertPerson('', 0, 'anna-1')).toEqual({ value: '@anna-1 ', caret: 8 });
  });
  it('replaces a typed @query', () => {
    expect(insertPerson('Hi @an', 6, 'anna-1')).toEqual({ value: 'Hi @anna-1 ', caret: 11 });
  });
  it('keeps the text after the caret', () => {
    expect(insertPerson('ab cd', 2, 'x1')).toEqual({ value: 'ab @x1  cd', caret: 7 });
  });
  it('property: the id is in the result and the rest of the draft is unchanged', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.nat(40), (value, c) => {
        const caret = Math.min(c, value.length);
        const r = insertPerson(value, caret, 'zed-9');
        expect(r.value).toContain('@zed-9 ');
        expect(r.value.endsWith(value.slice(caret))).toBe(true);
        expect(r.value.slice(r.caret - 1, r.caret)).toBe(' ');
      }),
    );
  });
});

describe('activeMentionTrigger', () => {
  it('finds an @ at the start or after white space, not one glued to a word', () => {
    expect(activeMentionTrigger('@an', 3)).toEqual({ start: 0, query: 'an' });
    expect(activeMentionTrigger('Hi @', 4)).toEqual({ start: 3, query: '' });
    expect(activeMentionTrigger('a@b', 3)).toBeNull();
    expect(activeMentionTrigger('@an x', 5)).toBeNull();
  });
});

describe('appendSeed (v3 Composer.svelte:37-52)', () => {
  it('appends to the draft after a space, caret at the end, nothing sent', () => {
    expect(appendSeed('Schau mal', '#f1 ')).toEqual({ value: 'Schau mal #f1 ', caret: 14 });
    expect(appendSeed('Schau ', '#f1 ')).toEqual({ value: 'Schau #f1 ', caret: 10 });
    expect(appendSeed('', '#f1 ')).toEqual({ value: '#f1 ', caret: 4 });
  });
});

describe('keys and body', () => {
  it('Enter sends, Shift+Enter and Alt+Enter add a line, an IME composition is left alone', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: false, altKey: false })).toBe(true);
    expect(isSendKey({ key: 'Enter', shiftKey: true, altKey: false })).toBe(false);
    expect(isSendKey({ key: 'Enter', shiftKey: false, altKey: true })).toBe(false);
    expect(isSendKey({ key: 'Enter', shiftKey: false, altKey: false, isComposing: true })).toBe(false);
    expect(isSendKey({ key: 'a', shiftKey: false, altKey: false })).toBe(false);
  });
  it('the body is trimmed; blank is empty', () => {
    expect(bodyOf('  hi \n')).toBe('hi');
    expect(bodyOf(' \n ')).toBe('');
  });
});
