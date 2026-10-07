import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cameraToMaplibre, zoomForHeight } from './camera';

describe('cameraToMaplibre', () => {
  it('maps center, zoom, bearing and pitch one to one', () => {
    expect(cameraToMaplibre({ center: [7.1, 50.7], zoom: 15, bearing: 30, pitch: 45 })).toEqual({
      center: [7.1, 50.7],
      zoom: 15,
      bearing: 30,
      pitch: 45,
    });
  });

  it('leaves out what the camera does not say', () => {
    expect(cameraToMaplibre({ center: [7.1, 50.7] })).toEqual({ center: [7.1, 50.7] });
  });

  it('derives the zoom from Z when there is no zoom', () => {
    expect(cameraToMaplibre({ center: [0, 0, 14_677.3] }).zoom).toBeCloseTo(12, 2);
  });

  it('an explicit zoom wins over Z', () => {
    expect(cameraToMaplibre({ center: [0, 0, 100], zoom: 9 }).zoom).toBe(9);
  });

  it('a Z of zero or less gives no zoom', () => {
    expect(cameraToMaplibre({ center: [0, 0, 0] }).zoom).toBeUndefined();
    expect(cameraToMaplibre({ center: [0, 0, -5] }).zoom).toBeUndefined();
  });
});

describe('zoomForHeight: log2(1.5 * equator circumference * cos(lat) / Z)', () => {
  it('at the equator: 14677 m is zoom 12, 459 m is zoom 17, 1.5 * C is zoom 0', () => {
    expect(zoomForHeight(14_677.3, 0)).toBeCloseTo(12, 2);
    expect(zoomForHeight(458.66, 0)).toBeCloseTo(17, 2);
    expect(zoomForHeight(1.5 * 40_075_016.686, 0)).toBeCloseTo(0, 6);
  });

  it('at 60 degrees north the same height needs one zoom level less', () => {
    expect(zoomForHeight(14_677.3, 60)).toBeCloseTo(11, 2);
  });

  it('is clamped to the schema range 0..24', () => {
    expect(zoomForHeight(1e12, 0)).toBe(0);
    expect(zoomForHeight(0.001, 0)).toBe(24);
  });

  it('property: the zoom never rises with the height', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e7, noNaN: true }),
        fc.double({ min: 1.01, max: 50, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        (z, k, lat) => {
          expect(zoomForHeight(z * k, lat)).toBeLessThanOrEqual(zoomForHeight(z, lat));
        },
      ),
    );
  });
});
