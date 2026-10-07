# 0002 · TypeScript end to end; SvelteKit is the only server process

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** v3 needed Go + Goja + TS and generated JS copies to share logic.
- **Decision:** All code is TypeScript. SvelteKit 2 / Svelte 5 serves the UI and API (adapter-node). No PocketBase, no Goja, no Go. UI: Tailwind 4, bits-ui/shadcn-svelte, Paraglide for UI strings.
- **Rejected:** PocketBase as a library (keeps Goja), a Go server with the core compiled to WASM.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
