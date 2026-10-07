import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createGeo, RESERVED_VERSION, type FeatureId, type TemplateFile } from '@ueberblick/core';
import { build, fid, headSeq, NOW, rid, setup } from '../store/run/testkit';
import { createDeriveFor } from './index';

const template = parse(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/golden/templates/veranstaltung/1.0.0.yaml', import.meta.url)),
    'utf8',
  ),
) as TemplateFile;
const config = build(template);
const square = (x: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 50],
      [x + 2, 50],
      [x + 2, 52],
      [x, 52],
      [x, 50],
    ],
  ],
});
const event = (n: number, x: number, datum: string) => ({
  id: fid(n),
  type: 'veranstaltung',
  properties: { geometrie: square(x), datum },
});

describe('the derive condition helper (R1)', () => {
  it('createDeriveFor rebuilds what the run transaction folded, through the same helper', () => {
    const ctx = setup({ config });
    ctx.seed([event(1, 7, '2026-06-01'), event(2, 8, '2026-06-01'), event(3, 8.5, '2026-06-02')]);
    const kollision = (): string[] =>
      ctx.db
        .prepare<{ from_id: string; to_id: string }>(
          "SELECT from_id, to_id FROM edges WHERE relation = 'kollision' ORDER BY from_id, to_id",
        )
        .all()
        .map((e) => `${e.from_id}>${e.to_id}`);
    const folded = kollision();
    expect(folded).toEqual([`${fid(1)}>${fid(2)}`, `${fid(2)}>${fid(1)}`]); // same datum and overlapping only

    const derive = createDeriveFor(ctx.db, {
      versions: {
        configFor: (v) => (v === 1 ? config : undefined),
        deployed: () => ({ version: 1, config }),
      },
      geo: createGeo(),
      clock: { now: () => NOW },
    });
    const all = [1, 2, 3].map((n) => fid(n) as FeatureId);
    expect(derive.recompute(all)).toEqual({ put: 0, remove: 0 }); // already what the fold made

    ctx.db.prepare("DELETE FROM edges WHERE relation = 'kollision'").run();
    expect(derive.recompute(all).put).toBe(2);
    expect(kollision()).toEqual(folded);
  });
});

describe('derive per version (A-029, WP-318)', () => {
  // v2 drops the "same datum" condition: any two overlapping events collide.
  const v2Template = structuredClone(template) as unknown as {
    types: { veranstaltung: { relations: { kollision: { derive: string } } } };
  };
  v2Template.types.veranstaltung.relations.kollision.derive =
    'self != other && intersects(self.geometrie, other.geometrie)';
  const v2 = build(v2Template as unknown as TemplateFile);
  const configs = new Map([
    [1, config],
    [2, v2],
  ]);
  const edges = (ctx: ReturnType<typeof setup>): string[] =>
    ctx.db
      .prepare<{ from_id: string; to_id: string }>(
        "SELECT from_id, to_id FROM edges WHERE relation = 'kollision' ORDER BY from_id, to_id",
      )
      .all()
      .map((e) => `${e.from_id}>${e.to_id}`);

  it('recomputes each feature under its own version; the floating one follows the deployed version', () => {
    const ctx = setup({ config, version: 1, configs: new Map([[2, v2]]), deployed: 2 });
    // same place, different day: v1 sees no collision, v2 does
    ctx.seed([event(1, 7, '2026-06-01'), event(2, 7, '2026-06-02')]);
    ctx.db.prepare("DELETE FROM edges WHERE relation = 'kollision'").run();
    ctx.seedObservations([
      { featureId: fid(1), property: RESERVED_VERSION, result: 1, seq: headSeq(ctx.db) + 1, runId: rid(1) },
    ]);
    const derive = createDeriveFor(ctx.db, {
      versions: {
        configFor: (v) => configs.get(v),
        deployed: () => ({ version: 2, config: v2 }),
      },
      geo: createGeo(),
      clock: { now: () => NOW },
    });
    // fid(1) is pinned to v1 (same day only): it sees nothing
    expect(derive.recompute([fid(1)] as FeatureId[])).toEqual({ put: 0, remove: 0 });
    expect(edges(ctx)).toEqual([]);
    // fid(2) floats (v2, any overlap): it sees fid(1). Like the run transaction, the reverse pass of a group uses the
    // group's own schema (the edge into the changed feature).
    derive.recompute([fid(2)] as FeatureId[]);
    expect(edges(ctx)).toContain(`${fid(2)}>${fid(1)}`);
  });

  it('with no pin it is one group of the deployed version', () => {
    const ctx = setup({ config, version: 1, configs: new Map([[2, v2]]), deployed: 2 });
    ctx.seed([event(1, 7, '2026-06-01'), event(2, 7, '2026-06-02')]);
    ctx.db.prepare("DELETE FROM edges WHERE relation = 'kollision'").run();
    const asked: number[] = [];
    const derive = createDeriveFor(ctx.db, {
      versions: {
        configFor: (v) => (asked.push(v), configs.get(v)),
        deployed: () => ({ version: 2, config: v2 }),
      },
      geo: createGeo(),
      clock: { now: () => NOW },
    });
    derive.recompute([fid(1), fid(2)] as FeatureId[]);
    expect(asked).toEqual([2]);
    expect(edges(ctx)).toEqual([`${fid(1)}>${fid(2)}`, `${fid(2)}>${fid(1)}`]);
  });
});
