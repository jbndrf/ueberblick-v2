/**
 * Test support: a small, independent QR decoder (byte mode, versions 1 to 6, error correction M) so a test can
 * prove the SVG the lens shows really decodes to the login link, without trusting the encoder's own matrix.
 */
const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
/** Error correction M: [blocks, data codewords per block] for versions 1 to 6. */
const M_BLOCKS: readonly (readonly [number, number])[] = [
  [1, 16],
  [1, 28],
  [1, 44],
  [2, 32],
  [2, 43],
  [4, 27],
];
const ALIGN: readonly number[] = [0, 0, 18, 22, 26, 30, 34];
const QUIET = 4;

/** The dark modules of an SVG made by `qrSvg`: `M<x>,<y>l` commands, less the quiet zone. */
export function modulesOfSvg(svg: string): { size: number; dark: boolean[][] } {
  const box = /viewBox="0 0 (\d+) \d+"/.exec(svg);
  if (!box) throw new Error('no viewBox');
  const size = Number(box[1]) - 2 * QUIET;
  const dark = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const m of svg.matchAll(/M(\d+),(\d+)l/g)) {
    const row = dark[Number(m[2]) - QUIET];
    if (row) row[Number(m[1]) - QUIET] = true;
  }
  return { size, dark };
}

export function decodeQr(svg: string): string {
  return decodeModules(modulesOfSvg(svg).dark);
}

/** Decodes a module matrix (no quiet zone), as `qrModules` returns it. */
export function decodeModules(dark: readonly (readonly boolean[])[]): string {
  const n = dark.length;
  const version = (n - 17) / 4;
  const at = (r: number, c: number): number => (dark[r]?.[c] ? 1 : 0);
  // Format information, first copy: 15 bits, xor 0x5412; bits 14..13 are the level, 12..10 the mask.
  let format = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 6 ? at(i, 8) : i < 8 ? at(i + 1, 8) : at(n - 15 + i, 8);
    format |= bit << i;
  }
  format ^= 0x5412;
  if (format >> 13 !== 0) throw new Error(`error correction level is not M: ${format >> 13}`);
  const mask = MASKS[(format >> 10) & 7];
  if (!mask) throw new Error('bad mask');

  const isFunction = (r: number, c: number): boolean => {
    if (r <= 8 && (c <= 8 || c >= n - 8)) return true;
    if (r >= n - 8 && c <= 8) return true;
    if (r === 6 || c === 6) return true;
    const a = ALIGN[version] ?? 0;
    return a > 0 && Math.abs(r - a) <= 2 && Math.abs(c - a) <= 2;
  };
  const bits: number[] = [];
  let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const cc of [c, c - 1]) {
        if (!isFunction(r, cc)) bits.push(at(r, cc) ^ (mask(r, cc) ? 1 : 0));
      }
    }
    up = !up;
  }
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    words.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  const [blocks, per] = M_BLOCKS[version - 1] ?? [1, 0];
  const data: number[] = [];
  for (let b = 0; b < blocks; b++) for (let j = 0; j < per; j++) data.push(words[j * blocks + b] ?? 0);

  const stream = data.flatMap((w) => Array.from({ length: 8 }, (_, k) => (w >> (7 - k)) & 1));
  const read = (from: number, len: number): number =>
    stream.slice(from, from + len).reduce((a, b) => a * 2 + b, 0);
  if (read(0, 4) !== 0b0100) throw new Error('not byte mode');
  const len = read(4, 8);
  const bytes = Array.from({ length: len }, (_, i) => read(12 + 8 * i, 8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}
