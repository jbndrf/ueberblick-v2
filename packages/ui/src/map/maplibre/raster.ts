// The one place an svg becomes an image for `map.addImage` (v3 `MapIconSet`, `map-icons.ts`: svg to canvas to image,
// once per distinct icon). Browser only; the renderer takes it as a port (`MaplibreRendererOptions.rasterize`).
import { sizedSvg } from '../marker-svg';

/** Turns `svg` into an image drawn at `px` CSS px; the image has twice that many pixels (register it with pixelRatio 2). */
export type Rasterize = (svg: string, px: number) => Promise<unknown>;

export const rasterizeSvg: Rasterize = async (svg, px) => {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedSvg(svg, px * 2))}`;
  await image.decode();
  return image;
};
