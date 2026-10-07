import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTypeEditor } from './sidebar-types-client';

const golden = (rel: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
    'utf8',
  );
const TEMPLATE = golden('templates/baumkataster/1.0.0.yaml');
const OVERLAY = golden('projects/musterstadt-baeume.yaml');

/** A draft server stand-in: GET answers overlay + revision, PUT is compare-and-swap. */
function server(start: { overlay: string; revision: number }) {
  const state = { ...start, puts: 0 };
  const f = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { overlay: string; revision: number };
      state.puts += 1;
      if (body.revision !== state.revision) return new Response('{}', { status: 409 });
      state.overlay = body.overlay;
      state.revision += 1;
      return new Response(JSON.stringify({ revision: state.revision }), { status: 200 });
    }
    // as the real routes: the draft names its template (a key), the template route gives the source
    if (String(_url).startsWith('/admin/shell/template/'))
      return new Response(JSON.stringify({ templateSrc: TEMPLATE }), { status: 200 });
    return new Response(
      JSON.stringify({ template: 'baumkataster', overlay: state.overlay, revision: state.revision }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { state, f };
}

describe('the sidebar edits the draft through GET + PUT', () => {
  it('addType writes an `add` entry under the named revision', async () => {
    const s = server({ overlay: OVERLAY, revision: 3 });
    const r = await createTypeEditor({ project: 'p', fetch: s.f }).addType('objektart', 'Neue Art', ['baum']);
    expect(r).toEqual({ ok: true, key: 'neue_art' });
    expect(parse(s.state.overlay).add['types.neue_art'].geometry).toBe('geometrie');
    expect(s.state.revision).toBe(4);
  });

  it('reorder writes `order.types`', async () => {
    const s = server({ overlay: OVERLAY, revision: 1 });
    expect(await createTypeEditor({ project: 'p', fetch: s.f }).reorder(['baum', 'baumart'])).toBe(true);
    expect(parse(s.state.overlay).order.types).toEqual(['baum', 'baumart']);
  });

  it('a stale revision (409) is read again once, then the edit is applied', async () => {
    const s = server({ overlay: OVERLAY, revision: 1 });
    let first = true;
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && first) {
        first = false;
        s.state.revision += 1; // someone else saved in between
      }
      return s.f(url, init);
    }) as unknown as typeof fetch;
    expect(await createTypeEditor({ project: 'p', fetch: f }).reorder(['baum'])).toBe(true);
    expect(s.state.puts).toBe(2);
  });

  it('a failing server reports false and writes nothing', async () => {
    const f = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    const editor = createTypeEditor({ project: 'p', fetch: f });
    expect(await editor.reorder(['baum'])).toBe(false);
    expect(await editor.addType('table', 'X', [])).toEqual({ ok: false });
  });
});
