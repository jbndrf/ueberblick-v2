# B-017 Offline pack file: v3's single-file `.ubpack` container, on the device
priority: medium        status: provisional
date: 2026-10-02   lead: b   work packages: WP-668   touches: offline packs (A-032), R13

## Context
v3's map package selector offers "Paket aus Datei importieren" and saves a pack to Downloads (`reference/src/lib/tiles/pack-bundle.ts`, `messages/de.json:1859,1863`). A field team copies a region onto a phone without a good connection. A-032 serves packs as one PMTiles file per layer, so v4 has no single pack file.

## Options
- A) Port v3's container: `"UBPK" | u32le manifestLength | manifest JSON | layer archives`. The manifest is the A-032 `PackManifestEntry` (with each layer's `sha256`) plus each layer's offset and length. The device writes it from its OPFS files (export) and splits and verifies it into OPFS (import). The server is untouched.
- B) A zip of the layer files plus the manifest.
- C) Ask the owner to drop the feature.

## Chosen (provisional)
A. It is v3's own format, so it is not an invention. It needs no zip dependency, a Blob window over it is still a valid PMTiles source, and an imported pack is verified by the same sha256 as a downloaded one. The format lives in one module (`packages/client/src/packs/bundle.ts`), and the server can later serve the same file.

## Cost to change later
low (one encode/decode module; files are device-local).
