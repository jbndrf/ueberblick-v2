# @ueberblick/tool-photo

The first tool (WP-527, decision 0017). A `field` tool for `file` properties: the participant takes a photo or picks an image, the tool downsizes it, drops location data, stores the bytes and produces the file list `[{sha256, name, mime}]`: each photo is appended to the current list, up to the property's `max_files` (default 10), and its type is matched against the property's `accept` (the pickers offer `image/*` when the property has none).

## Use

The app gives the host a lazy loader, so the tool code loads only when a form shows a photo field:

```ts
const host = createToolHost({
  loaders: { photo: () => import('@ueberblick/tool-photo').then((m) => m.photoTool) },
  ports: { blobs, hash: webCryptoHash },
  optionsFor: (toolKey) => file.tools?.[toolKey] ?? {},
});
// in the FormRenderer `tool` snippet: <ToolMount {host} {slot} {locale} />
```

A form field selects it with `tool: photo`.

The gallery of the files already in the value (thumbnails, remove, lightbox) is drawn by the form above the tool (`packages/ui/src/form/gallery`), so the tool has no preview of its own. `ctx.value` is live: after the gallery removed a file, the next photo is appended to what is left. At `max_files` the pickers stay but refuse with a message (`aria-disabled`); the camera button is only offered when the property accepts a JPEG.

## Options

They come from the project file's `tools.photo` settings (ToolSettingsSchema); the app fills the host's `optionsFor` from there. Per-field overrides are a later question.

| Option          | Default | Meaning                                                                    |
| --------------- | ------- | -------------------------------------------------------------------------- |
| `maxEdge`       | 2048    | Longest edge in pixels (16 to 16384); never enlarges                       |
| `quality`       | 0.85    | JPEG quality, above 0 up to 1                                              |
| `allowLocation` | false   | Keep the EXIF of the original (GPS). Otherwise all EXIF and XMP is removed |

Absent options take the default. A present but invalid option throws a `ToolHostError` with code `invalid_option` when the tool mounts; the slot then shows that the input is unavailable.

## How it works

- `photo-tool.ts`: the DOM (two native file inputs: camera via `capture`, and file picker; labelled, keyboard-operable, status in a live region), then `process` -> sha256 (hash port) -> `blobs.put` (blob port) -> `produce`.
- `worker.ts` + `canvas-raster.ts`: decode (orientation applied), resize and JPEG encode on an `OffscreenCanvas` in a worker; the main thread never touches pixels.
- `pipeline.ts` + `exif.ts`: the metadata policy, pure and unit-tested. When location is allowed, the original EXIF is carried over with the orientation reset to normal (the pixels are already rotated).
- Output is always JPEG; the name keeps the original stem with `.jpg`.

The tool's strings (de, en) are in its own Paraglide catalogue, `messages/{de,en}.json` (keys `photo_*`); `src/messages.ts` is only the typed accessor.

## Tests and benchmark

`npm test -- packages/tools/photo`; `npm test -- -c bench/vitest.config.ts bench/photo-pipeline`. The canvas step needs a browser and is not covered by unit tests.
