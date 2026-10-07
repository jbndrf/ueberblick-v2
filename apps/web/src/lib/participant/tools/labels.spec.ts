import { describe, expect, it } from 'vitest';
import { TOOL_MANIFEST } from './manifest';
import { TEXT_KEYS, toolDescription, toolName } from './labels';

describe('tool labels', () => {
  it('every manifest tool has a name and a description in German and English', () => {
    expect([...TEXT_KEYS].sort()).toEqual(TOOL_MANIFEST.map((t) => t.key).sort());
    for (const t of TOOL_MANIFEST)
      for (const l of ['de', 'en'] as const) {
        expect(toolName(l, t.key)).not.toBe(t.key);
        expect(toolDescription(l, t.key).length).toBeGreaterThan(5);
      }
  });
  it('are v3-style: German by default, a real English translation', () => {
    expect(toolName('de', 'measure')).toBe('Messen');
    expect(toolName('en', 'measure')).toBe('Measure');
    expect(toolName('de', 'search')).toBe('Suche');
  });
  it('an unknown tool shows its key and no description', () => {
    expect(toolName('de', 'neu')).toBe('neu');
    expect(toolDescription('de', 'neu')).toBe('');
  });
});
