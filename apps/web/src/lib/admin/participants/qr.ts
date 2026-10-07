/**
 * The one seam to the QR encoder (A-026): `qrSvg(text)` returns an inline SVG, `qrModules(text)` the module matrix.
 * The encoder (`qrcode-generator`, MIT, no dependencies) is loaded with a dynamic import, so it is a separate chunk that the
 * page's entry does not contain. Swapping the library, or drawing the code on the server, changes only this file.
 */

/** Error correction M (about 15 % of the code can be damaged): good for a printed sheet that gets folded. */
const ERROR_CORRECTION = 'M';
/** The quiet zone in modules; the specification asks for four. */
const QUIET_ZONE = 4;

/** The dark modules of the code, row by row, without the quiet zone (the PDF draws them as vector squares). */
export async function qrModules(text: string): Promise<boolean[][]> {
  const { default: qrcode } = await import('qrcode-generator');
  const code = qrcode(0, ERROR_CORRECTION);
  code.addData(text, 'Byte');
  code.make();
  const n = code.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => code.isDark(r, c)));
}

/** An SVG of the code, scalable (it has a `viewBox` and no fixed size), dark modules on a white ground. */
export async function qrSvg(text: string): Promise<string> {
  const { default: qrcode } = await import('qrcode-generator');
  const code = qrcode(0, ERROR_CORRECTION);
  code.addData(text, 'Byte');
  code.make();
  return code.createSvgTag({ cellSize: 1, margin: QUIET_ZONE, scalable: true });
}
