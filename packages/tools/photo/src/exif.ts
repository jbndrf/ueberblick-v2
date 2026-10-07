// JPEG metadata handling: strip EXIF/XMP (privacy) or carry the EXIF of the original over (fields that
// allow location). Pure byte work, no DOM; it runs inside the worker.

const SOI = 0xffd8;
const APP1 = 0xe1;
const SOS = 0xda;
const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const ORIENTATION_TAG = 0x0112;

interface Segment {
  readonly marker: number;
  readonly start: number;
  readonly end: number;
}

const at = (b: Uint8Array, i: number): number => b[i] ?? 0;

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && ((at(b, 0) << 8) | at(b, 1)) === SOI;
}

/** The header segments of a JPEG, up to the start of the scan. */
function segments(b: Uint8Array): { list: Segment[]; scanStart: number } {
  const list: Segment[] = [];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = at(b, i + 1);
    if (marker === SOS) break;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    const standalone = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
    const end = standalone ? i + 2 : i + 2 + ((at(b, i + 2) << 8) | at(b, i + 3));
    if (end > b.length) break;
    list.push({ marker, start: i, end });
    i = end;
  }
  return { list, scanStart: i };
}

const hasExifId = (b: Uint8Array, s: Segment) => EXIF_ID.every((v, k) => b[s.start + 4 + k] === v);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Removes every APP1 segment (EXIF and XMP, where GPS can live). Non-JPEG bytes pass through. */
export function stripMetadata(jpeg: Uint8Array): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg;
  const { list } = segments(jpeg);
  const drop = list.filter((s) => s.marker === APP1);
  if (drop.length === 0) return jpeg;
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const s of drop) {
    parts.push(jpeg.subarray(at, s.start));
    at = s.end;
  }
  parts.push(jpeg.subarray(at));
  return concat(parts);
}

/** The EXIF segment of the original, with the orientation reset to "normal" because the pixels were
 * already rotated when the image was redrawn. `null` when there is none. */
export function exifForReuse(original: Uint8Array): Uint8Array | null {
  if (!isJpeg(original)) return null;
  const seg = segments(original).list.find((s) => s.marker === APP1 && hasExifId(original, s));
  if (!seg) return null;
  const out = original.slice(seg.start, seg.end);
  const view = new DataView(out.buffer);
  const tiff = 10;
  const little = out[tiff] === 0x49;
  if (out.length < tiff + 8) return out;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > out.length) return out;
  const count = view.getUint16(ifd, little);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > out.length) break;
    if (view.getUint16(entry, little) === ORIENTATION_TAG) view.setUint16(entry + 8, 1, little);
  }
  return out;
}

/** Inserts an EXIF segment right after the start-of-image marker. */
export function withExif(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg;
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** True when the JPEG carries an EXIF segment. */
export function hasExif(jpeg: Uint8Array): boolean {
  return isJpeg(jpeg) && segments(jpeg).list.some((s) => s.marker === APP1 && hasExifId(jpeg, s));
}

/** GPS block presence in the EXIF (tag 0x8825 in IFD0), for tests and the location decision. */
export function hasGps(jpeg: Uint8Array): boolean {
  if (!isJpeg(jpeg)) return false;
  const seg = segments(jpeg).list.find((s) => s.marker === APP1 && hasExifId(jpeg, s));
  if (!seg) return false;
  const view = new DataView(jpeg.buffer, jpeg.byteOffset + seg.start, seg.end - seg.start);
  const tiff = 10;
  const little = view.getUint8(tiff) === 0x49;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  const count = view.getUint16(ifd, little);
  for (let n = 0; n < count; n++) if (view.getUint16(ifd + 2 + n * 12, little) === 0x8825) return true;
  return false;
}
