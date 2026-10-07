// @vitest-environment jsdom
// WP-635: drawing lines and areas on the map (session, geometry, validity, and the binding to a MapHandle).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo, type Position } from '@ueberblick/core/geo';
import type { MapHandle, MarkerOptions, OverlayStyle } from '../contract';
import { createDrawController } from './controller';
import { buildGeometry, evaluate, partsOf } from './model';
import { createSession } from './session';

const geo = createGeo();
const A: Position = [9, 48];
const B: Position = [9.001, 48];
const C: Position = [9.001, 48.001];
const D: Position = [9, 48.001];

function fakeHandle() {
  const overlays = new Map<
    string,
    { geometry: { type: string; coordinates: unknown }; style: OverlayStyle }
  >();
  const markers = new Map<string, { at: Position; options: MarkerOptions }>();
  const taps = new Set<(at: Position) => void>();
  const drags = new Set<(id: string, at: Position) => void>();
  const calls = { features: 0 };
  const handle = {
    showOverlay: (id: string, geometry: never, style: OverlayStyle) => overlays.set(id, { geometry, style }),
    clearOverlay: (id: string) => void overlays.delete(id),
    addMarker: (id: string, at: Position, options: MarkerOptions) => void markers.set(id, { at, options }),
    moveMarker: (id: string, at: Position) => {
      const m = markers.get(id);
      if (m) m.at = at;
    },
    markerPosition: (id: string) => markers.get(id)?.at,
    removeMarker: (id: string) => void markers.delete(id),
    onMarkerDrag: (f: (id: string, at: Position) => void) => {
      drags.add(f);
      return () => drags.delete(f);
    },
    onMapTap: (f: (at: Position) => void) => {
      taps.add(f);
      return () => taps.delete(f);
    },
  } as unknown as MapHandle;
  return {
    handle,
    overlays,
    markers,
    calls,
    tap: (p: Position) => taps.forEach((f) => f(p)),
    drag: (id: string, p: Position) => {
      const m = markers.get(id);
      if (m) m.at = p;
      drags.forEach((f) => f(id, p));
    },
  };
}
const colors = { active: '#f00', idle: '#00f' };

describe('session', () => {
  it('a line needs two vertices, an area three, before Fertig is on', () => {
    const line = createSession('linestring', true);
    line.add(A);
    expect(line.canFinish()).toBe(false);
    line.add(B);
    expect(line.canFinish()).toBe(true);
    const area = createSession('polygon', true);
    area.add(A);
    area.add(B);
    expect(area.canFinish()).toBe(false);
    area.add(C);
    expect(area.canFinish()).toBe(true);
  });

  it('Rückgängig takes the last vertex back, Wiederherstellen returns it', () => {
    const s = createSession('linestring', true);
    s.add(A);
    s.add(B);
    s.add(C);
    s.undo();
    expect(s.parts()[0]?.points).toEqual([A, B]);
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.parts()[0]?.points).toEqual([A, B, C]);
    s.undo();
    s.add(D);
    expect(s.canRedo()).toBe(false);
  });

  it('Neues Element starts another part; an empty part is not duplicated', () => {
    const s = createSession('linestring', true);
    s.newPart();
    expect(s.parts()).toHaveLength(1);
    s.add(A);
    s.add(B);
    s.newPart();
    expect(s.parts()).toHaveLength(2);
    expect(s.active()).toBe(1);
    s.newPart();
    expect(s.parts()).toHaveLength(2);
  });

  it('a stub below the minimum is dropped when the next part starts (v3)', () => {
    const s = createSession('polygon', true);
    s.add(A);
    s.newPart();
    expect(s.parts()).toHaveLength(1);
    expect(s.parts()[0]?.points).toEqual([]);
  });

  it('undo acts on the active part only', () => {
    const s = createSession('linestring', true);
    s.add(A);
    s.add(B);
    s.newPart();
    s.add(C);
    s.add(D);
    s.activate(0);
    s.undo();
    expect(s.parts().map((p) => p.points.length)).toEqual([1, 2]);
  });

  it('Element löschen removes the active part and a fresh one takes over when none is left', () => {
    const s = createSession('linestring', true);
    s.add(A);
    s.add(B);
    s.newPart();
    s.add(C);
    s.deleteActive();
    expect(s.parts()).toHaveLength(1);
    s.deleteActive();
    expect(s.parts()).toHaveLength(1);
    expect(s.parts()[0]?.points).toEqual([]);
  });

  it('tapping the first vertex closes an area with three vertices and starts the next part', () => {
    const s = createSession('polygon', true);
    s.add(A);
    s.add(B);
    expect(s.closeRing(0)).toBe(false);
    s.add(C);
    expect(s.closeRing(0)).toBe(true);
    expect(s.parts()[0]?.closed).toBe(true);
    expect(s.parts()).toHaveLength(2);
    expect(s.active()).toBe(1);
  });

  it('a drag is one undo step however many moves it has', () => {
    const s = createSession('linestring', true);
    s.add(A);
    s.add(B);
    s.moveVertex(0, 1, [9.0005, 48]);
    s.moveVertex(0, 1, [9.0006, 48]);
    s.moveVertex(0, 1, C);
    s.endMove();
    expect(s.parts()[0]?.points[1]).toEqual(C);
    s.undo();
    expect(s.parts()[0]?.points[1]).toEqual(B);
  });
});

describe('geometry', () => {
  it('a single-part property gets a LineString or Polygon, a multi-part one always Multi* (owner Q21)', () => {
    const one = { points: [A, B, C], closed: false };
    const two = { points: [D, A, B], closed: false };
    expect(buildGeometry([one], 'linestring', false)?.type).toBe('LineString');
    expect(buildGeometry([one], 'linestring', true)?.type).toBe('MultiLineString');
    expect(buildGeometry([one, two], 'linestring', true)?.type).toBe('MultiLineString');
    expect(buildGeometry([one], 'polygon', false)?.type).toBe('Polygon');
    expect(buildGeometry([one], 'polygon', true)?.type).toBe('MultiPolygon');
    expect(buildGeometry([one, two], 'polygon', true)?.type).toBe('MultiPolygon');
  });

  it('a single-part property does not take two parts; Neues Element does nothing there', () => {
    const one = { points: [A, B, C], closed: false };
    expect(buildGeometry([one, one], 'polygon', false)).toBeUndefined();
    const s = createSession('polygon', false);
    s.add(A);
    s.newPart();
    expect(s.parts()).toHaveLength(1);
  });

  it('a bow-tie part of a multi-part area is refused, not split into two areas', () => {
    const out = evaluate(geo, [{ points: [A, C, B, D], closed: false }], 'polygon', true);
    expect(out.state).toBe('refused');
  });

  it('parts below the minimum are left out, as v3 does', () => {
    const stub = { points: [A], closed: false };
    expect(buildGeometry([stub], 'linestring', false)).toBeUndefined();
    expect(buildGeometry([stub, { points: [A, B], closed: false }], 'linestring', false)?.type).toBe(
      'LineString',
    );
  });

  it('a self-intersecting area is refused with the core.geo issue', () => {
    const bowtie = { points: [A, C, B, D], closed: false };
    const out = evaluate(geo, [bowtie], 'polygon', false);
    expect(out.state).toBe('refused');
    if (out.state === 'refused') expect(out.issues[0]?.issue).toBe('self_intersection');
  });

  it('a valid area is accepted, repaired to the right winding', () => {
    const out = evaluate(geo, [{ points: [A, D, C, B], closed: false }], 'polygon', false);
    expect(out.state).toBe('ok');
  });

  it('two separate areas make a valid MultiPolygon', () => {
    const far = (p: Position): Position => [p[0] + 1, p[1]];
    const out = evaluate(
      geo,
      [
        { points: [A, B, C, D], closed: true },
        { points: [A, B, C, D].map(far), closed: true },
      ],
      'polygon',
      true,
    );
    expect(out.state === 'ok' && out.geometry.type).toBe('MultiPolygon');
  });

  it('property: n vertices on a line always give a valid LineString with n positions', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })),
          {
            minLength: 2,
            maxLength: 20,
          },
        ),
        (xs) => {
          const points = xs.map(([x, y], i): Position => [9 + i * 0.01 + x * 0.001, 48 + y * 0.001]);
          const out = evaluate(geo, [{ points, closed: false }], 'linestring', false);
          expect(out.state).toBe('ok');
          if (out.state === 'ok' && out.geometry.type === 'LineString')
            expect(out.geometry.coordinates).toHaveLength(points.length);
        },
      ),
    );
  });
});

describe('controller (strict fake handle)', () => {
  it('draws each part as one overlay and each vertex as a draggable marker', () => {
    const f = fakeHandle();
    const s = createSession('linestring', true);
    createDrawController(f.handle, s, colors);
    f.tap(A);
    expect(f.markers.size).toBe(1);
    expect(f.overlays.size).toBe(0);
    f.tap(B);
    expect(f.overlays.get('draw-part-0')?.geometry).toEqual({ type: 'LineString', coordinates: [A, B] });
    expect(f.overlays.get('draw-part-0')?.style.color).toBe(colors.active);
    expect([...f.markers.values()].every((m) => m.options.draggable === true)).toBe(true);
  });

  it('an open area is a dashed polygon until the ring is closed, then solid', () => {
    const f = fakeHandle();
    const s = createSession('polygon', true);
    createDrawController(f.handle, s, colors);
    [A, B, C].forEach(f.tap);
    expect(f.overlays.get('draw-part-0')?.geometry.type).toBe('Polygon');
    expect(f.overlays.get('draw-part-0')?.style.dashed).toBe(true);
    s.closeRing(0);
    expect(f.overlays.get('draw-part-0')?.style.dashed).toBe(false);
    expect(f.overlays.get('draw-part-0')?.style.color).toBe(colors.idle);
  });

  it('dragging a vertex moves it in the session and re-draws the overlay', () => {
    const f = fakeHandle();
    const s = createSession('linestring', true);
    createDrawController(f.handle, s, colors);
    f.tap(A);
    f.tap(B);
    f.drag('draw-vertex-0-1', C);
    expect(s.parts()[0]?.points[1]).toEqual(C);
    expect(f.overlays.get('draw-part-0')?.geometry.coordinates).toEqual([A, C]);
  });

  it('Rückgängig and Element löschen remove markers and overlays; destroy leaves nothing behind', () => {
    const f = fakeHandle();
    const s = createSession('linestring', true);
    const c = createDrawController(f.handle, s, colors);
    f.tap(A);
    f.tap(B);
    s.undo();
    expect(f.markers.size).toBe(1);
    expect(f.overlays.size).toBe(0);
    s.add(B);
    s.newPart();
    f.tap(C);
    f.tap(D);
    expect(f.overlays.size).toBe(2);
    s.deleteActive();
    expect(f.overlays.size).toBe(1);
    c.destroy();
    expect(f.markers.size).toBe(0);
    expect(f.overlays.size).toBe(0);
  });

  it('clicking the first vertex of an area closes it', () => {
    const f = fakeHandle();
    const s = createSession('polygon', true);
    createDrawController(f.handle, s, colors);
    [A, B, C].forEach(f.tap);
    f.markers.get('draw-vertex-0-0')?.options.element.click();
    expect(s.parts()[0]?.closed).toBe(true);
    expect(s.active()).toBe(1);
  });

  it('never touches features: the handle used has no feature or view method', () => {
    const f = fakeHandle();
    const s = createSession('polygon', true);
    createDrawController(f.handle, s, colors);
    [A, B, C, D].forEach(f.tap);
    expect(Object.keys(f.handle)).not.toContain('setView');
    expect(f.calls.features).toBe(0);
  });
});

describe('partsOf (WP-687: a stored shape is loaded to be redrawn)', () => {
  it('is the inverse of buildGeometry, for lines and areas, single and multi', () => {
    const line = { points: [A, B], closed: false };
    const ring = { points: [A, B, C, D], closed: true };
    expect(partsOf(buildGeometry([line], 'linestring', false), 'linestring')).toEqual([line]);
    expect(partsOf(buildGeometry([line, line], 'linestring', true), 'linestring')).toEqual([line, line]);
    expect(partsOf(buildGeometry([ring], 'polygon', false), 'polygon')).toEqual([ring]);
    expect(partsOf(buildGeometry([ring, ring], 'polygon', true), 'polygon')).toEqual([ring, ring]);
  });
  it('a point, a shape of the other kind or nothing gives no parts', () => {
    expect(partsOf({ type: 'Point', coordinates: A }, 'polygon')).toEqual([]);
    expect(
      partsOf(buildGeometry([{ points: [A, B], closed: false }], 'linestring', false), 'polygon'),
    ).toEqual([]);
    expect(partsOf(undefined, 'polygon')).toEqual([]);
  });
  it('a session opened on parts starts with them and can finish unchanged', () => {
    const ring = { points: [A, B, C, D], closed: true };
    const s = createSession('polygon', false, [ring]);
    expect(s.parts()).toEqual([ring]);
    expect(s.canFinish()).toBe(true);
    expect(s.canUndo()).toBe(false);
  });
});
