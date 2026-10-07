// Test helpers: a synthetic JPEG with EXIF (orientation 6 and a GPS pointer).
function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

export function exifSegment(opts: { gps: boolean; orientation: number }): Uint8Array {
  // Little-endian TIFF: header, IFD0 with 1 or 2 entries.
  const entries: number[][] = [[0x12, 0x01, 3, 0, 1, 0, 0, 0, opts.orientation, 0, 0, 0]];
  if (opts.gps) entries.push([0x25, 0x88, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  const tiff = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, entries.length, 0, ...entries.flat(), 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return Uint8Array.from([0xff, 0xe1, ...u16(body.length + 2), ...body]);
}

export function jpeg(
  opts: { exif?: { gps: boolean; orientation: number }; xmp?: boolean; scan?: number } = {},
) {
  const parts: number[][] = [
    [0xff, 0xd8],
    [0xff, 0xe0, 0, 4, 0, 0],
  ];
  if (opts.exif) parts.push([...exifSegment(opts.exif)]);
  if (opts.xmp) parts.push([0xff, 0xe1, 0, 6, 0x68, 0x74, 0x74, 0x70]);
  parts.push([0xff, 0xdb, 0, 4, 1, 2]);
  const scan = new Uint8Array(opts.scan ?? 8).fill(0x11);
  return Uint8Array.from([...parts.flat(), 0xff, 0xda, 0, 4, 1, 2, ...scan, 0xff, 0xd9]);
}
