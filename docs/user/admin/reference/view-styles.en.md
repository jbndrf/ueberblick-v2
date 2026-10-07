# Styling a view on the map

A view layer with the renderer `maplibre-2d` can carry a `style`: an object (or `{ "$ref": "path" }`) in the MapLibre Style Spec format. Only its `layers` list is used.

```json
{ "layers": [ { "id": "ub-single", "type": "circle", "source": "ub-clusters",
  "filter": ["!", ["has", "clusterId"]],
  "paint": { "circle-color": ["case", ["==", ["get", "status"], "open"], "#c53030", "#2f855a"] } } ] }
```

- **Replace or add:** A layer with one of the default ids (`ub-shape-fill`, `ub-shape-line`, `ub-cluster`, `ub-cluster-count`, `ub-single`) replaces that default. Any other id adds a layer, drawn below the look layers, so it never covers or tints a feature. Every layer on these two sources can be tapped, whatever its id.
- **Single points only, counts on top:** A layer you add on `ub-clusters` draws single points only, never the clusters (no filter needed). Cluster circles and their counts are always drawn last and stay readable. To style clusters differently, replace `ub-cluster` or `ub-cluster-count`. If you give an added layer on `ub-clusters` a filter, it must use expression syntax (e.g. `["==", ["get", "art"], "x"]`); the legacy syntax is refused.
- **Sources:** Use only `ub-clusters` (clusters: `clusterId`, `count`; single points: `featureId` and the properties your style reads) and `ub-geometry` (areas and lines; their own properties and `id`). Read properties with `["get", "key"]`.
- **Errors:** An invalid layer is refused and named by its `id`; the map keeps the previous look.
- **Style files:** `{ "$ref": "styles/name.json" }` points to a file in the project. The publish stops while a layer's style is such a reference; the style must then stand in the project directly as an object. A style whose `layers` are not a list of objects with an `id` also stops the publish and names the layer.
- **Search fields:** Every entry of the search tool's `sources` is `type.property` and must name a text, select, number or integer property of that type. Anything else stops the publish and names the entry.

## Icons and colours by value

A feature type (`types.<type>`) sets how its features look on the map, without writing a style:

```yaml
marker: { color: "#2f855a", icon: { key: tree-deciduous } }     # the look of the feature type
classify:                                                        # one select property (the stage too)
  property: stage
  values:
    erfasst: { color: "#2b6cb0" }
    massnahme: { color: "#c05621", icon: { key: wrench } }
    melden: { color: "#d53f8c", icon: { $ref: icons/spielplatz.svg, size: 36 } }
```

- **Order:** the value (`classify.values`), then `marker`, then the plain dot. Colour and icon fall back one by one.
- **Icons:** `{ key }` from camera, check, circle-alert, clipboard-check, flag, house, info, leaf, map-pin, pencil, trash-2, tree-deciduous, triangle-alert, wrench (drawn in the colour), `{ svg }` with your own SVG, or `{ $ref: icons/name.svg }` with a file of the project (embedded when it is read in). `size` (8 to 128, default 32) is in pixels.
- **The property:** `classify.property` is a select property of the type (not a multiselect); every entry of `values` must be one of its options. The same property sets the switches in Karteninhalt and the rows of the group sheet; without `classify` it is the stage.
- **Checks:** Publishing stops for a property that is not a select, a value that is not an option, and an SVG over 50 KB, with a script, event attributes, other elements or a reference to the outside.
- **Replacing:** If your style replaces the default layer `ub-single`, `ub-shape-fill` or `ub-shape-line`, that layer stays as your style writes it.
- **Do not paint over a feature type that has a look:** When a feature type has a look (`marker`, `classify`), it is the same as in the filter sheet. A style on layers of that type should not cover its points and areas with its own circles, fills or lines, or the map and the filter sheet disagree. Labels and other context layers are fine. The example templates carry no style for feature types with a look any more.
