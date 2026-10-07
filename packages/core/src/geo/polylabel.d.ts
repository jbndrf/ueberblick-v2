/** polylabel ships no types. It returns the pole of inaccessibility [x, y]; `precision` is in coordinate units. */
declare module 'polylabel' {
  export default function polylabel(
    polygon: readonly (readonly (readonly [number, number])[])[],
    precision?: number,
  ): [number, number];
}
