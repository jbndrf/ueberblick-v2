// WP-588: the OGC discovery answers in the language the request asked for (Accept-Language), then de, then en.
import type { CompiledConfig } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { golden } from '../../store/run/testkit';
import { ogcWorld } from './testkit';

function withLabel(label: string | Record<string, string>): CompiledConfig {
  const config = golden('musterstadt-plain');
  const baum = config.file.types?.['baum'];
  if (baum === undefined) throw new Error('golden template has no baum');
  return { ...config, file: { ...config.file, types: { ...config.file.types, baum: { ...baum, label } } } };
}

async function titleOf(label: string | Record<string, string>, acceptLanguage?: string): Promise<string> {
  const config = withLabel(label);
  const w = await ogcWorld({ deps: { deployed: () => ({ version: 1, config }) } });
  const res = await w.handlers.handle(
    new Request('http://x/api/p/trees/ogc/collections/baum', {
      headers: {
        cookie: w.cookies.admin,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
    }),
    { params: { project: 'trees', path: 'collections/baum' } },
  );
  return ((await res.json()) as { title: string }).title;
}

describe('ogc discovery locale', () => {
  const both = { de: 'Baum', en: 'Tree' };
  it('answers in the requested language', async () => {
    expect(await titleOf(both, 'en')).toBe('Tree');
    expect(await titleOf(both, 'en-GB,en;q=0.8')).toBe('Tree');
    expect(await titleOf(both, 'de')).toBe('Baum');
  });
  it('falls back to de, then en, when the request names no available language', async () => {
    expect(await titleOf(both)).toBe('Baum');
    expect(await titleOf(both, 'fr')).toBe('Baum');
    expect(await titleOf({ en: 'Tree', fr: 'Arbre' }, 'it')).toBe('Tree');
  });
});
