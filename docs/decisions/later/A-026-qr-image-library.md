# A-026 QR login codes are drawn by a small MIT QR encoder, lazy-loaded in the participants lens
priority: low        status: provisional
date: 2026-09-30   lead: a   work packages: WP-176, WP-177   touches: O7 (licence) / docs/12 bundle budgets / H3 role apps

## Context
WP-176 built the participants lens. There is no QR encoder in the tree, so the one-time sheet shows only the login link (with Copy and Print). Field workers are meant to scan a code, not type a link.

## Options
- A) Link only. No dependency, but it defeats the QR login flow for field teams.
- B) Add a small, dependency-free MIT QR encoder (for example `qrcode-generator`), rendered as SVG, loaded with a dynamic import only when the sheet opens. MIT is compatible with the AGPL-3.0 placeholder (O7) and with any later open-core line.
- C) Write our own encoder. Rejected: Reed-Solomon, masking and version tables are real work, and not our domain.

## Chosen (provisional)
B. The seam is one builder function `qrSvg(text): Promise<string>`. Only the participants sheet calls it, so swapping the library, or moving to server-rendered codes, touches one file. The encoder stays out of the builder's entry chunk (lazy, like CodeMirror, WP-164).

## Cost to change later
now: one dependency plus one function · later: replace the function body
