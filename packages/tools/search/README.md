# @ueberblick/tool-search

A `tools-sheet` tool (WP-552, decision 0017) that finds features by text over the view's `tools.search.sources` (`type.property` entries, docs/05). It only reads (R3).

- **The index is the device store's** (WP-555 `searchText`), reached through `ctx.searchText`. The tool builds no index and never scans (R14). **The app must call `store.indexText(type, property)` for every source at open**; an unregistered source makes `searchText` throw `text_source_not_indexed`, and the tool then says "Search is not ready".
- Matching (prefix per word, case and diacritics folded, queued runs included) is the store's. `searchFeatures(ports, sources, query, limit)` in `model.ts` is a pure read over two ports, so a later API can reuse it (H4).
- A result is labelled with the first source property of its type that holds text. Tapping it calls `ctx.map.centerOn` with core.geo's point on the surface of the feature type's declared primary geometry (`FoldType.primaryGeometry`; a feature without one gets no centring, only the sheet), then `ctx.openFeature(id)` (one tap).
- At most 20 results are shown (the index is asked for 21 to know whether there are more).

## Use

The sources come from the project's `tools.search` settings, and the panel context has no per-tool options, so the app builds the tool (a `defineTool` result) with them:

```ts
import { createGeo } from '@ueberblick/core/geo';
const settings = project.tools.search ?? {};
const sources = readSearchSources(settings); // [{ type, property }], throws invalid_option on a bad entry
for (const s of sources) store.indexText(s.type, s.property);
const host = createToolHost({
  loaders: {
    search: () =>
      import('@ueberblick/tool-search').then((m) =>
        m.createSearchTool({
          geo: createGeo(),
          sources,
          primaryGeometry: (type) => folds.types[type]?.primaryGeometry,
        }),
      ),
  },
  ports,
});
```

## Tests and benchmark

`src/model.spec.ts` (including a property test against a brute-force filter), `src/search-tool.spec.ts` (jsdom through the host, axe) and `bench/search-tool` (60k features, keystroke to results).
