// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Key } from '@ueberblick/core/model';
import { createToolHost } from '@ueberblick/ui';
import { testMap, testPorts } from '@ueberblick/ui/tool-testing';
import { createSearchTool } from './search-tool';
import { message } from './messages';

const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'messages', `${locale}.json`), 'utf8'),
  ) as Record<string, string>;

async function render(locale: string): Promise<HTMLElement> {
  const host = createToolHost({
    loaders: {
      search: async () =>
        createSearchTool({
          geo: createGeo(),
          sources: [{ type: 'baum' as Key, property: 'nummer' }],
          primaryGeometry: () => 'lage' as Key,
        }),
    },
    ports: testPorts(),
    locale,
  });
  const root = document.createElement('div');
  document.body.append(root);
  await host.mountPanel(root, {
    point: 'tools-sheet',
    toolKey: 'search',
    startTask: vi.fn(),
    map: testMap(),
    openFeature: vi.fn(),
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (k) => k,
  });
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('search tool: its own Paraglide catalogue', () => {
  it.each(['de', 'en'])('renders its labels in %s from messages/<locale>.json', async (locale) => {
    const cat = catalogue(locale);
    const root = await render(locale);
    expect(root.querySelector<HTMLInputElement>('input')?.placeholder).toBe(cat['search_placeholder']);
  });

  it.each(['de', 'en'])('interpolates values in %s', (locale) => {
    expect(message(locale, 'none', { query: 'x' })).toBe(
      (catalogue(locale)['search_none'] ?? '').replace('{query}', 'x'),
    );
  });
});
