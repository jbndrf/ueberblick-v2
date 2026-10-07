import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { exifForReuse, hasExif, hasGps, stripMetadata } from './exif';
import {
  DEFAULT_PHOTO_OPTIONS,
  fitWithin,
  processImage,
  readPhotoOptions,
  type Rasterizer,
} from './pipeline';
import { jpeg } from './testing';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}

describe('fitWithin', () => {
  it('never enlarges and keeps the aspect ratio (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 16, max: 8000 }),
        (w, h, edge) => {
          const r = fitWithin(w, h, edge);
          expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(
            Math.max(edge, Math.min(Math.max(w, h), edge)),
          );
          expect(r.width).toBeLessThanOrEqual(w);
          expect(r.height).toBeLessThanOrEqual(h);
          expect(r.width).toBeGreaterThanOrEqual(1);
          expect(Math.abs(r.width / r.height - w / h)).toBeLessThan(
            Math.max(w / h, 1) / Math.min(r.width, r.height) + 1e-9,
          );
        },
      ),
    );
  });
  it('12 MP down to the edge', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
});

describe('metadata', () => {
  it('strips EXIF and XMP but keeps the image data (property over scan sizes)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), fc.boolean(), (scan, gps) => {
        const src = jpeg({ exif: { gps, orientation: 6 }, xmp: true, scan });
        const out = stripMetadata(src);
        expect(hasExif(out)).toBe(false);
        expect(out.length).toBeLessThan(src.length);
        expect(Array.from(out.subarray(-scan - 2))).toEqual(Array.from(src.subarray(-scan - 2)));
      }),
    );
  });
  it('reuses the EXIF with the orientation reset to normal', () => {
    const seg = must(exifForReuse(jpeg({ exif: { gps: true, orientation: 6 } })));
    const view = new DataView(seg.buffer);
    expect(view.getUint16(10 + 8 + 2 + 8, true)).toBe(1);
    expect(exifForReuse(jpeg())).toBeNull();
  });
  it('non-JPEG bytes pass through', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(stripMetadata(png)).toBe(png);
  });
});

describe('processImage', () => {
  const original = jpeg({ exif: { gps: true, orientation: 6 } });
  // An encoder that leaks metadata, to prove the pipeline itself strips.
  const leaky: Rasterizer = async (_b, t) => ({
    bytes: jpeg({ exif: { gps: true, orientation: 1 }, xmp: true }),
    width: t.maxEdge,
    height: 1,
  });

  it('drops location unless the field allows it', async () => {
    const out = await processImage(original, DEFAULT_PHOTO_OPTIONS, leaky);
    expect(hasExif(out.bytes)).toBe(false);
    expect(hasGps(out.bytes)).toBe(false);
  });
  it('keeps the original location when the field allows it', async () => {
    const out = await processImage(original, { ...DEFAULT_PHOTO_OPTIONS, allowLocation: true }, leaky);
    expect(hasGps(out.bytes)).toBe(true);
  });
  it('hands the configured edge and quality to the rasterizer', async () => {
    let seen: unknown;
    await processImage(original, { maxEdge: 640, quality: 0.5, allowLocation: false }, async (_b, t) => {
      seen = t;
      return { bytes: jpeg(), width: 1, height: 1 };
    });
    expect(seen).toMatchObject({ maxEdge: 640, quality: 0.5 });
  });
});

describe('readPhotoOptions', () => {
  it('reads valid options and uses defaults only for absent ones', () => {
    expect(readPhotoOptions({ maxEdge: 1024, quality: 0.7, allowLocation: true })).toEqual({
      maxEdge: 1024,
      quality: 0.7,
      allowLocation: true,
    });
    expect(readPhotoOptions({})).toEqual(DEFAULT_PHOTO_OPTIONS);
  });
  it('a present but invalid option is a typed error, not a silent default', () => {
    for (const bad of [
      { maxEdge: -5 },
      { maxEdge: 1.5 },
      { quality: 'x' },
      { quality: 0 },
      { allowLocation: 'yes' },
    ]) {
      expect(() => readPhotoOptions(bad)).toThrowError(expect.objectContaining({ code: 'invalid_option' }));
    }
  });
});
