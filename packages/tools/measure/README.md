# @ueberblick/tool-measure

A `tools-sheet` tool (WP-552, decision 0017) that measures a distance or an area. It only reads: it shows one temporary overlay on the map through `ctx.map` and prints numbers. It never writes (R3).

- **Every number is core.geo** (R1): distance is `derive(LineString).lengthM` (the last leg is `distanceM`), area is `derive(Polygon).areaM2` and `.lengthM` (perimeter) of the outline after `normalise`. An outline that fails `validate` (for example a crossing) is refused with the core.geo issue, not measured.
- Units are metric: m and km, m², ha and km².
- `model.ts` is pure and DOM-free; `measure-tool.ts` is the panel.

## Use

```ts
const host = createToolHost({
  loaders: { measure: () => import('@ueberblick/tool-measure').then((m) => m.measureTool) },
  ports,
});
```

## Points

Points come from a tap on the map (`ctx.map.onTap`) or from the device position (**Add my position**, `ctx.ports.position`). Both add the same kind of point, and unmounting stops listening to taps.

## Tests

`src/model.spec.ts` (fixtures against core.geo, refusal, formats, a property test over the WGS84 range) and `src/measure-tool.spec.ts` (jsdom through the tool host, axe).
