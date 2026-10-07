// WP-359: the real manifest response is core's `PackManifest`, checked by core's own decoder (A-032 item 3).
import { decodePackManifest } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { packWorld } from './packs.testkit';

const fetchJson = async (as: string, lang?: string): Promise<unknown> => {
  const w = await packWorld();
  const res = await w.handlers.manifest(w.request('', as, lang ? { 'accept-language': lang } : {}), {
    params: { project: 'demo' },
  });
  return res.json();
};

describe('the pack manifest contract', () => {
  it('the decoder accepts the real response (several packs, layers and languages)', async () => {
    for (const lang of ['de', 'en']) {
      const json = await fetchJson('verwaltung', lang);
      const out = decodePackManifest(json);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.manifest.packs.map((p) => p.key)).toEqual(['innen', 'intern']);
      expect(out.manifest.packs[0]?.layers.map((l) => l.layer)).toEqual(['basis', 'flur']);
      expect(out.manifest.packs[1]?.label).toBe(lang === 'en' ? 'Internal' : 'Intern');
      expect(out.manifest).toEqual(json);
    }
  });

  it('refuses a mutated response at the path of the wrong field', async () => {
    const json = (await fetchJson('verwaltung')) as { packs: { layers: Record<string, unknown>[] }[] };
    const layer = json.packs[0]?.layers[1];
    if (layer === undefined) throw new Error('no layer');
    layer['sha256'] = 'nope';
    expect(decodePackManifest(json)).toEqual({
      ok: false,
      reason: 'packs[0].layers[1].sha256: must be 64 lowercase hex digits',
    });
  });
});
