import { describe, expect, it } from 'vitest';
import { SHEET_SLOTS, type SheetSlot } from './sheets';
import { afterMapTap, detailOpen, close, fabStep, stepFab, toggle, type Panels } from './panels';

const GROUP = ['layers', 'filter', 'tools', 'settings'];

describe('the sheets that stand over the map', () => {
  it('a bar button opens its sheet and the same button closes it again', () => {
    expect(toggle([], 'layers')).toEqual(['layers']);
    expect(toggle(['layers'], 'layers')).toEqual([]);
  });

  it('Layer, Filter, Werkzeuge and Einstellungen are one group: opening one replaces another', () => {
    expect(toggle(['layers'], 'filter')).toEqual(['filter']);
    expect(toggle(['settings'], 'tools')).toEqual(['tools']);
  });

  it('the + button cycles: Neu, Neu with Zuletzt beside it, closed', () => {
    const one = stepFab([]);
    expect(one).toEqual(['create']);
    expect(fabStep(one)).toBe(1);
    const two = stepFab(one);
    expect(two).toEqual(['create', 'recent']);
    expect(fabStep(two)).toBe(2);
    expect(stepFab(two)).toEqual([]);
  });

  it('opening a group sheet closes the + sheets and keeps the open detail (v3: the layer sheet does not touch the selection); the + closes the group sheet and keeps it too', () => {
    expect(toggle(['create', 'recent'], 'layers')).toEqual(['layers']);
    expect(toggle(['feature'], 'filter')).toEqual(['feature', 'filter']);
    expect(toggle(['cluster'], 'settings')).toEqual(['cluster', 'settings']);
    expect(stepFab(['filter'])).toEqual(['create']);
    expect(stepFab(['feature', 'filter'])).toEqual(['feature', 'create']);
  });

  it('the feature sheet closes Neu but keeps Zuletzt open beside it (a row tap keeps Zuletzt) and a group sheet stands', () => {
    expect(toggle(['create'], 'feature')).toEqual(['feature']);
    expect(toggle(['recent'], 'feature')).toEqual(['recent', 'feature']);
    expect(toggle(['create', 'recent', 'layers'], 'feature')).toEqual(['recent', 'layers', 'feature']);
    const open = toggle(['recent'], 'feature');
    expect(close(open, 'feature')).toEqual(['recent']);
    expect(toggle(open, 'feature')).toEqual(['recent']); // the same toggle closes it
  });

  it("the cluster sheet is the map's own like the feature sheet: one of the two stands, Zuletzt stays", () => {
    expect(toggle(['create', 'recent'], 'cluster')).toEqual(['recent', 'cluster']);
    expect(toggle(['cluster'], 'feature')).toEqual(['feature']);
    expect(toggle(['feature'], 'cluster')).toEqual(['cluster']);
    expect(stepFab(['cluster'])).toEqual(['cluster', 'create']);
  });

  it('a header button for Zuletzt opens it with Neu and the detail left as they were, and closes a group sheet', () => {
    expect(toggle(['create'], 'recent')).toEqual(['create', 'recent']);
    expect(toggle(['layers'], 'recent')).toEqual(['recent']);
    expect(toggle(['feature'], 'recent')).toEqual(['feature', 'recent']);
  });

  it('a tap on empty map closes the detail, the cluster detail, Neu and Zuletzt, and leaves a group sheet (v3 handleMapClick)', () => {
    expect(afterMapTap(['feature', 'recent', 'create', 'layers'])).toEqual(['layers']);
    expect(afterMapTap(['cluster'])).toEqual([]);
    expect(afterMapTap([])).toEqual([]);
    expect(afterMapTap(['feature', 'create'], true)).toEqual(['feature', 'create']); // placing a pin: the tap sets the pin only
  });

  it('the chat is no group sheet: Layer, Filter, Werkzeuge and Einstellungen open and close with it standing (v3 `chatSheetOpen` is its own flag, `+page.svelte:2516-2540` never reset it); only the + closes it (`:218,266`)', () => {
    expect(toggle(['layers'], 'chat')).toEqual(['layers', 'chat']);
    expect(toggle(['layers', 'chat'], 'settings')).toEqual(['chat', 'settings']);
    expect(toggle(['chat', 'settings'], 'settings')).toEqual(['chat']);
    expect(toggle(['chat'], 'tools')).toEqual(['chat', 'tools']);
    expect(toggle(['chat'], 'filter')).toEqual(['chat', 'filter']);
    expect(toggle(['chat'], 'chat')).toEqual([]);
    expect(toggle(['chat', 'feature'], 'feature')).toEqual(['chat']);
    expect(toggle(['chat'], 'feature')).toEqual(['chat', 'feature']); // a # chip: the feature opens beside the chat
    expect(stepFab(['chat'])).toEqual(['create']);
    expect(stepFab(['chat', 'feature', 'layers'])).toEqual(['feature', 'create']);
    expect(afterMapTap(['chat', 'feature'])).toEqual(['chat']);
  });

  it('a tap that closes nothing returns the same list, so the open tool panel is not rebuilt (WP-691: Measure lost its points)', () => {
    const open: Panels = ['tools'];
    expect(afterMapTap(open)).toBe(open);
    const none: Panels = [];
    expect(afterMapTap(none)).toBe(none);
  });

  it('is Zuletzt beside a detail', () => {
    expect(detailOpen(['feature', 'recent'])).toBe(true);
    expect(detailOpen(['cluster', 'recent'])).toBe(true);
    expect(detailOpen(['recent'])).toBe(false);
    expect(detailOpen(['feature'])).toBe(false);
  });

  it('property: any sequence of taps never holds two group sheets or a duplicate', () => {
    let seed = 7;
    const rnd = (n: number): number => (seed = (seed * 48271) % 2147483647) % n;
    let state: Panels = [];
    for (let i = 0; i < 500; i++) {
      state =
        rnd(5) === 0 ? stepFab(state) : toggle(state, SHEET_SLOTS[rnd(SHEET_SLOTS.length)] as SheetSlot);
      expect(new Set(state).size).toBe(state.length);
      expect(state.filter((s) => GROUP.includes(s)).length).toBeLessThanOrEqual(1);
      expect(state.filter((s) => s === 'feature' || s === 'cluster').length).toBeLessThanOrEqual(1);
      expect(afterMapTap(state).every((s) => GROUP.includes(s) || s === 'chat')).toBe(true);
    }
  });
});
