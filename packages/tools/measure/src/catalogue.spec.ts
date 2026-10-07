// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import { createToolHost } from '@ueberblick/ui';
import { testMap, testPorts } from '@ueberblick/ui/tool-testing';
import { createMeasureTool } from './measure-tool';
import { issueText, message } from './messages';

const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'messages', `${locale}.json`), 'utf8'),
  ) as Record<string, string>;

async function render(locale: string): Promise<string> {
  const host = createToolHost({
    loaders: { measure: async () => createMeasureTool({ geo: createGeo() }) },
    ports: testPorts(),
    locale,
  });
  const root = document.createElement('div');
  document.body.append(root);
  await host.mountPanel(root, {
    point: 'tools-sheet',
    toolKey: 'measure',
    startTask: vi.fn(),
    map: testMap(),
    openFeature: vi.fn(),
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (k) => k,
  });
  return root.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('measure tool: its own Paraglide catalogue', () => {
  it.each(['de', 'en'])('renders its labels in %s from messages/<locale>.json', async (locale) => {
    const cat = catalogue(locale);
    const text = await render(locale);
    expect(text).toContain(cat['measure_usePosition']);
    expect(text).toContain(cat['measure_distance']);
    expect(text).toContain(cat['measure_hint']);
  });

  it.each(['de', 'en'])('interpolates values and issue words in %s', (locale) => {
    const cat = catalogue(locale);
    expect(message(locale, 'total', { value: '5 m' })).toBe(
      (cat['measure_total'] ?? '').replace('{value}', '5 m'),
    );
    expect(issueText(locale, 'ring_not_closed')).toBe(cat['measure_issue_ring_not_closed']);
  });
});
