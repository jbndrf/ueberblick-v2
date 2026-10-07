// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createToolHost, type ToolField } from '@ueberblick/ui';
import { testPorts } from '@ueberblick/ui/tool-testing';
import { createPhotoTool } from './photo-tool';
import { message } from './messages';

const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'messages', `${locale}.json`), 'utf8'),
  ) as Record<string, string>;
const field: ToolField = { key: 'foto', id: 'f-foto', label: 'Photo', type: 'file' };

async function render(locale: string): Promise<string> {
  const host = createToolHost({
    loaders: {
      photo: async () =>
        createPhotoTool({ processor: { process: async () => Promise.reject(new Error('unused')) } }),
    },
    ports: testPorts(),
    locale,
    optionsFor: () => ({}),
  });
  const root = document.createElement('div');
  document.body.append(root);
  await host.mountField(root, {
    toolKey: 'photo',
    field,
    value: undefined,
    onproduce: () => {},
    onclear: () => {},
  });
  return root.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('photo tool: its own Paraglide catalogue', () => {
  it.each(['de', 'en'])('renders its labels in %s from messages/<locale>.json', async (locale) => {
    const cat = catalogue(locale);
    const text = await render(locale);
    expect(text).toContain(cat['photo_take']);
    expect(text).toContain(cat['photo_choose']);
  });

  it('falls back to English for other locales', () => {
    expect(message('fr', 'take')).toBe(catalogue('en')['photo_take']);
  });
});
