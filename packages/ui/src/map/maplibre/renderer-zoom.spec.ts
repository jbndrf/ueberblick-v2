import { describe, expect, it } from 'vitest';
import { mount, tick } from './renderer-fixture';

describe('maplibre-2d renderer: zoomBy (the zoom buttons)', () => {
  it('eases to the current zoom plus the delta, keeping the centre', async () => {
    const { handle, calls } = mount(undefined, undefined, { reducedMotion: () => false });
    await handle.ready;
    await tick();
    const before = calls.eased.length;
    handle.zoomBy(1);
    expect(calls.eased.slice(before)).toEqual([{ zoom: 4 }]);
  });

  it('jumps when the user prefers reduced motion', async () => {
    const { handle, calls } = mount(undefined, undefined, { reducedMotion: () => true });
    await handle.ready;
    await tick();
    const before = calls.eased.length;
    handle.zoomBy(-1);
    expect(calls.eased.slice(before)).toEqual([{ zoom: 2, duration: 0 }]);
  });

  it('is ignored before the map is drawn and after destroy', async () => {
    const { handle, calls } = mount();
    handle.zoomBy(1);
    await handle.ready;
    handle.destroy();
    handle.zoomBy(1);
    expect(calls.eased).toEqual([]);
  });
});
