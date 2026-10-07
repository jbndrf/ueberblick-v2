/**
 * WP-694 (A-040): a participant with no stored filter starts from the project's start filter (v3 `+page.svelte:1061-1146`);
 * a stored personal filter always wins, and a changed start reaches only those who never stored one.
 */
import { describe, expect, it } from 'vitest';
import { startFilter } from '@ueberblick/core';
import type { Key } from '@ueberblick/core/model';
import { createFilterController } from './filter-controller';
import { isVisible, memoryPrefs } from './filter-state';

const baum = 'baum' as Key;
const bank = 'bank' as Key;
const startOf = (hide: Key[]) =>
  startFilter({
    types: Object.fromEntries(hide.map((k) => [k, { on_at_start: false, properties: {} }])),
  } as never);

describe('filter controller start state', () => {
  it('starts from the start filter when nothing is stored', () => {
    const c = createFilterController(memoryPrefs(), startOf([bank]));
    expect(isVisible(c.state(), bank, undefined)).toBe(false);
    expect(isVisible(c.state(), baum, undefined)).toBe(true);
  });

  it('does not store the start: a later start still reaches a person who never switched anything', () => {
    const prefs = memoryPrefs();
    createFilterController(prefs, startOf([bank]));
    const after = createFilterController(prefs, startOf([baum]));
    expect(isVisible(after.state(), baum, undefined)).toBe(false);
    expect(isVisible(after.state(), bank, undefined)).toBe(true);
  });

  it('a stored personal filter wins, also after the start changed', () => {
    const prefs = memoryPrefs();
    const first = createFilterController(prefs, startOf([bank]));
    first.setType(baum, false); // the person's own choice: bank was hidden by start, now baum hidden, bank shown
    first.setType(bank, true);
    const second = createFilterController(prefs, startOf([bank, baum]));
    expect(isVisible(second.state(), baum, undefined)).toBe(false);
    expect(isVisible(second.state(), bank, undefined)).toBe(true);
  });

  it('a person who stored "show everything" keeps it against a start that hides', () => {
    const prefs = memoryPrefs();
    const first = createFilterController(prefs, startOf([bank]));
    first.setType(bank, true);
    const second = createFilterController(prefs, startOf([bank]));
    expect(isVisible(second.state(), bank, undefined)).toBe(true);
  });

  it('without a start the map shows everything, as before', () => {
    const c = createFilterController(memoryPrefs());
    expect(isVisible(c.state(), bank, undefined)).toBe(true);
  });
});
