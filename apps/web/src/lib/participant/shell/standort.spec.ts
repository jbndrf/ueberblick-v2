import { describe, expect, it, vi } from 'vitest';
import { POSITION_ZOOM } from '@ueberblick/ui';
import { showStandort } from './standort';

const style = { color: '#4285F4', width: 5 };

describe('Standort', () => {
  it('centres the map on the fix at street level and marks it', async () => {
    const map = { centerOn: vi.fn(), showOverlay: vi.fn() };
    const ok = await showStandort(map, { current: () => Promise.resolve({ lon: 7.1, lat: 50.7 }) });
    expect(ok).toBe(true);
    expect(map.centerOn).toHaveBeenCalledWith([7.1, 50.7], { zoom: POSITION_ZOOM });
    expect(map.showOverlay).toHaveBeenCalledWith(
      'standort',
      { type: 'Point', coordinates: [7.1, 50.7] },
      style,
    );
  });

  it('hands the accuracy over, so the map draws the circle in true metres', async () => {
    const map = { centerOn: vi.fn(), showOverlay: vi.fn() };
    await showStandort(map, { current: () => Promise.resolve({ lon: 7.1, lat: 50.7, accuracy: 23 }) });
    expect(map.showOverlay).toHaveBeenCalledWith(
      'standort',
      { type: 'Point', coordinates: [7.1, 50.7] },
      { ...style, accuracy: 23 },
    );
  });

  it('a refused permission or a missing signal leaves the map where it is and says so (false)', async () => {
    const map = { centerOn: vi.fn(), showOverlay: vi.fn() };
    const ok = await showStandort(map, { current: () => Promise.reject(new Error('denied')) });
    expect(ok).toBe(false);
    expect(map.centerOn).not.toHaveBeenCalled();
    expect(map.showOverlay).not.toHaveBeenCalled();
  });
});
