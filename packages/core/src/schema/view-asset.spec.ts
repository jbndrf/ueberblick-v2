import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ASSET_FORMATS } from '../registry';
import { ViewSchema } from './index';

const load = (glob: Record<string, unknown>): string => Object.values(glob)[0] as string;
const validRaw = load(
  import.meta.glob('./__fixtures__/valid/view-asset.yaml', { query: '?raw', import: 'default', eager: true }),
);
const casesRaw = load(
  import.meta.glob('./__fixtures__/invalid/view-asset-cases.yaml', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

interface Case {
  name: string;
  path: string;
  view: unknown;
}
const cases = parse(casesRaw) as Case[];

describe('view asset sources and camera (H1)', () => {
  it('accepts asset layers and a camera with Z', () => {
    const r = ViewSchema.safeParse(parse(validRaw));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.camera?.center).toEqual([13.4, 52.5, 34.0]);
  });
  it('accepts a camera with only a 2D center', () => {
    expect(ViewSchema.safeParse({ source: { type: 'baum' }, camera: { center: [13.4, 52.5] } }).success).toBe(
      true,
    );
  });
  it('still accepts a feature source with a filter', () => {
    expect(
      ViewSchema.safeParse({
        source: { type: 'baum' },
        layers: { l: { renderer: 'maplibre-2d', source: { type: 'baum', filter: 'true' } } },
      }).success,
    ).toBe(true);
  });
  for (const c of cases) {
    it(`rejects: ${c.name}`, () => {
      const r = ViewSchema.safeParse(c.view);
      expect(r.success).toBe(false);
      const paths = r.error?.issues.map((i) => i.path.join('.')) ?? [];
      expect(paths.some((p) => p === c.path || p.startsWith(`${c.path}.`))).toBe(true);
    });
  }
  it('takes asset formats from the registry', () => {
    expect(ASSET_FORMATS.keys).toContain('3dtiles');
    for (const format of ASSET_FORMATS.keys) {
      const r = ViewSchema.safeParse({
        source: { type: 'baum' },
        layers: { l: { renderer: 'maplibre-2d', source: { asset: 'blob/x/', format } } },
      });
      expect(r.success).toBe(true);
    }
  });
});
