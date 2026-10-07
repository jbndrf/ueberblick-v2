import { describe, expect, it } from 'vitest';
import { deriveProcesses } from './graph';
import { goldenDoc, must, templates } from './fixtures';
import { edgeShape, layout, NODE } from './layout';

describe('layout', () => {
  it('places every node inside the canvas without overlap, and every arrow has a shape', () => {
    for (const [key, version] of templates) {
      const file = goldenDoc(key, version).effective();
      for (const type of Object.keys(file.types ?? {})) {
        for (const p of deriveProcesses(file, type)) {
          const l = layout(p);
          const boxes = [...l.nodes.values()];
          expect(boxes).toHaveLength(p.nodes.length);
          for (const b of boxes) {
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.x + NODE.width).toBeLessThanOrEqual(l.width);
            expect(b.y + NODE.height).toBeLessThanOrEqual(l.height);
          }
          const keys = new Set(boxes.map((b) => `${b.x},${b.y}`));
          expect(keys.size).toBe(boxes.length);
          p.edges.forEach((e, i) => expect(edgeShape(e, l, i)?.d).toMatch(/^M/));
        }
      }
    }
  });

  it('puts a node reached by an arrow one column right of its source', () => {
    const p = must(
      deriveProcesses(goldenDoc('maengelmelder', '1.0.0').effective(), 'meldung').find(
        (q) => q.property === 'status',
      ),
    );
    const l = layout(p);
    const e = must(p.edges.find((x) => x.from !== undefined && x.from !== x.to && x.origin === 'task'));
    const source = must(l.nodes.get(must(e.from)));
    const target = must(l.nodes.get(e.to));
    // Nodes sit in columns of fixed width.
    expect(target.x - source.x).toSatisfy((d: number) => d % (NODE.width + NODE.gapX) === 0);
  });
});
