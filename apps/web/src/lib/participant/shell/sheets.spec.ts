// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SHEET_SLOTS, SHEETS, sheetLoader } from './sheets';

// This spec proves the registry wiring (which slot key loads a component), never a sheet's rendering: every
// registered slot's module is replaced by a marked stub, so no case imports a real sheet chunk (cold transforms of
// MapLibre and friends ran past 60 s under load, WP-899 / WP-673). Each sheet's rendering has its own spec.
// One vi.mock line per slot, in the same order as SHEETS. A new slot needs one line here; the guard below fails without it.
const stub = vi.hoisted(() => ({
  make: () => ({ default: Object.assign(function SheetStub() {}, { isSheetStub: true }) }),
}));
vi.mock('../sheets/layer/LayerSlot.svelte', stub.make);
vi.mock('./FilterSlot.svelte', stub.make);
vi.mock('./CreateSlot.svelte', stub.make);
vi.mock('./SettingsSlot.svelte', stub.make);
vi.mock('../sheets/tools/ToolsSlot.svelte', stub.make);
vi.mock('./RecentSlot.svelte', stub.make);
vi.mock('./FeatureSlot.svelte', stub.make);
vi.mock('../cluster/ClusterSlot.svelte', stub.make);
vi.mock('../sheets/tools/ChatSlot.svelte', stub.make);

describe('the sheet registry', () => {
  it('has the ported sheets and only them: Neu is registered', () => {
    const registered = SHEET_SLOTS.filter((s) => sheetLoader(s) !== undefined);
    expect(registered).toEqual([
      'layers',
      'filter',
      'create',
      'recent',
      'tools',
      'settings',
      'feature',
      'cluster',
      'chat',
    ]);
    expect(Object.keys(SHEETS).sort()).toEqual([...registered].sort());
  });

  // One test per slot: each lazy chunk gets its own time budget, so a slow transform under load (the map-heavy
  // `layers` sheet) cannot starve the others (flake watch in docs/process/flakes.md).
  const registered = SHEET_SLOTS.filter((s) => sheetLoader(s) !== undefined);
  it.each(registered)(
    'the %s slot loads a component',
    async (slot) => {
      const loader = sheetLoader(slot);
      expect(loader, slot).toBeDefined();
      if (loader === undefined) return;
      const loaded = (await loader()).default as unknown as { readonly isSheetStub?: boolean };
      expect(typeof loaded, slot).toBe('function');
      // The guard: a slot without a vi.mock line above loads the real chunk and fails here.
      expect(loaded.isSheetStub, `${slot} has no stub in sheets.spec.ts`).toBe(true);
    },
    5_000,
  );
});
