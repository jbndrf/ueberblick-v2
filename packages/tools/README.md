# packages/tools/*

Tool plug-ins, one package each (decision 0017). The public **`defineTool`** API (WP-553, `TOOL_API_VERSION` 3) was extracted from the four real tools, photo, draw, measure and search. The host lives in `packages/ui/src/tool-host`; tool code imports only `@ueberblick/ui/tool-api` (types, `defineTool`, `ToolHostError`), so a lazily loaded tool does not pull the design system.

## Authoring guide

A tool is one `defineTool` call. Its `contributes` list says where it plugs in (registry `TOOL_CONTRIBUTIONS`: `tools-sheet`, `filter-tab`, `layer-section`, `feature-action`, `settings-section`, `form-field`); the host mounts it only there. Types plus a runtime guard keep the two contexts apart:

```ts
import { defineTool } from '@ueberblick/ui/tool-api';

// Inside a task (`form-field`, alone): produces the value of one property type, and nothing else.
export const myTool = defineTool({
  key: 'my_tool', // the `tool:` key in the project file
  contributes: ['form-field'],
  produces: 'geometry', // 'file' | 'geometry' (PRODUCIBLE_SHAPES; new types append there)
  settings: { max_edge: { type: 'integer', min: 16, default: 2048 } }, // what the admin sets
  preferences: { unit: { type: 'select', options: ['m', 'ft'], default: 'm' } }, // what the person may change
  mount(el, ctx) {
    // ctx: field, locale, value (this field only), options, ports, produce(value), clear(),
    //      settings, preferences, setPreference(key, value)
    return { destroy() {} };
  },
});

// Outside tasks (any sheet points): reads, or starts a task. Never produces a value.
export const myBarTool = defineTool({
  key: 'my_bar_tool',
  contributes: ['tools-sheet', 'feature-action'],
  mount(el, ctx) {
    // ctx: point, locale, ports, startTask, map, openFeature, searchText, feature, typeLabel,
    //      settings, preferences, setPreference
    return { destroy() {} };
  },
});
```

- **Settings and preferences:** `settings` are option schemas the admin fills (`tools.<key>` for the project, `roles.<r>.app.tools.<key>.settings` for a role); `preferences` are the ones the person may change, each with a default. `ctx.settings` = schema defaults, project, role. `ctx.preferences` = defaults, project, role, then the person's own values (only preference keys). `ctx.setPreference` checks the key and value against the `preferences` schema (`invalid_preference`) and stores it through the host's `person` port. A shipped tool's settings schema also sits in `BUILTIN_TOOL_SCHEMAS` (`@ueberblick/core/registry`) so `compile` can check the project file without importing the tool (R1: the tool passes that same object).
- **Availability:** the host mounts a tool only when it is on for the person (`tool_off` otherwise): the role lists it (`offered` or `active`) and the person has not switched an `active` one off, or has switched an `offered` one on. Without a `person` port the host applies no gate.
- **`produce(value)`** sets the field; the host checks the value against `PRODUCIBLE_SHAPES[produces]` and throws `ToolHostError` `invalid_value` otherwise. **`clear()`** removes the stored value; it is a separate call, a `null` value is refused. Both throw `unmounted` after `destroy`.
- **Ports** (all required): `blobs.put(sha256, bytes, mime)`, `hash.sha256(bytes)`, `position.current()` (a `PositionFix` `{lon, lat, alt?, accuracy?}`, `accuracy` the radius of the 68 % confidence circle in metres, rejects when the device cannot tell). A tool never reads `navigator.geolocation` itself.
- **Map port** (panel tools): `centerOn`, `showOverlay`, `clearOverlay`, and `onTap(handler)`, which returns the unsubscribe function; call it in `destroy`.
- **Options** come from the project's `tools.<key>` settings as opaque JSON; the tool validates them and throws `ToolHostError` `invalid_option` for a bad value.
- **Factories:** a tool that needs dependencies (a `Geo`, a processor, search sources) is a factory returning a `defineTool` result (`createSearchTool({ geo, sources, primaryGeometry })`). Ports the host owns (position, blobs) come through `ctx`, never through the factory.
- **Loading:** the app registers `() => import('@ueberblick/tool-x')` loaders; the module's export is the `defineTool` result. The host validates it (`assertTool`): an object that was not made with `defineTool`, or that targets another `TOOL_API_VERSION`, is refused with `invalid_definition` or `unsupported_api`.
- **Data streams (`ctx.data`, tool API 3, B-020):** a `tools-sheet` tool that declares `data: true` gets the port of its own stream: `items()` (oldest first, then waiting sends), `subscribe`, `append(body)` (stored in the device outbox at once, sent in the background), `cursor`, `markRead(seq)`, `retry(id)`, `discard(id)`. The host gives it only when the person has the tool (`toolAvailabilityFor`); a tool never calls the network. The app boots one `createToolData` per device (`apps/web/src/lib/participant/tools/device-data.ts`): its own database, the tool routes, the `event: tool` doorbell, and the pulls of `createAutoSync`. The Werkzeuge badge of such a tool is a function in the app's `tools/badges.ts`, so the shell knows no tool names.
- **Offline:** a tool never uses the network. The contract suite stubs `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` and fails if they are called.

## Contract suite

Every tool spec ends with `describeToolContract({ name, tool, field?, options?, ports?, panel?, drive? })` from `@ueberblick/ui/tool-testing`. It checks: made by `defineTool` for this API version (frozen), mounts into its element and unmounts without a trace (destroy twice is fine, no map listener left), produces only values of its property type (a panel tool none), and works offline. `drive(root)` uses the mounted tool once so a `form-field` tool produces a value. `testPorts()` and `testMap()` build ports for tests.

## Versioning and extension

`TOOL_API_VERSION` changes when any context or port changes incompatibly; the host refuses other versions (H6: third-party tools are built against a version, the API is not for user-supplied scripts). New contribution points append to the `TOOL_CONTRIBUTIONS` registry (H1 viewers and H4 assistants are `form-field` tools, H5 live layers `layer-section` tools); new producible types append to `PRODUCIBLE_SHAPES`; new ports are added to `ToolPorts` and are additive (bump the version only when a port changes shape).

First tool: `photo` (WP-527), see `photo/README.md`. The host lives in `packages/ui/src/tool-host`.

Second tool: `draw` (WP-551), see `draw/README.md`.

Third and fourth tools: `measure` and `search` (WP-552), both `tools-sheet` tools that only read; see `measure/README.md` and `search/README.md`.
Fifth tool: `file` (WP-658), see `file/README.md`.

## Messages: each tool ships its own catalogue (WP-586)

Every label a tool shows is a Paraglide message in the tool's own package, never in `packages/ui` and never in a `messages.ts` table (R1, R6). A third-party tool brings its catalogue the same way and needs no change elsewhere (R13).

```
packages/tools/<name>/
  messages/de.json, en.json      keys prefixed `<name>_`, sorted (npm run messages:sort), same keys in both
  project.inlang/settings.json   copy of packages/ui's (plugin path ../../../node_modules/...)
  package.json                   "i18n": "paraglide-js compile --project ./project.inlang --outdir ./src/paraglide"
  src/messages.ts                typed accessor: message(locale, key, values) over ./paraglide/messages.js
```

- `src/paraglide` is generated and git-ignored. Vitest compiles every tool's catalogue in its global setup (`packages/tools/vitest.global-setup.ts` finds each `project.inlang`); `npm run typecheck` and the web build run each tool's `i18n` script.
- The host passes `ctx.locale`; the accessor maps anything that is not German to English. Paraglide tree-shakes per message.
- A `catalogue.spec.ts` per tool renders the tool in de and en from its own JSON. `apps/web/src/lib/participant/catalogues.spec.ts` checks de/en key parity and sorting of every catalogue and fails if a string table (`const EN = {…}`) reappears in a tool or the participant app.
- Issue words for `core.geo` validity issues are keyed `<name>_issue_<issue>`: a new registry key fails to compile until it has words.

`file` (WP-658): the v3 "Dateien" button for `file` properties of any `accept` type. One native file input (multiple when `max_files` > 1), bytes stored unchanged through the blob port, appended to the list; refuses types outside `accept` and anything past `max_files`. The file rows and remove buttons are the gallery's, not the tool's.

Sixth tool: `chat` (WP-684, B-020), the Projekt-Chat, the first tool with a data stream; see `packages/tools/chat/README.md`.
