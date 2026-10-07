// Drawing on the live map: binds a DrawSession to a MapHandle. Each part is one overlay (v3 drew them in one GeoJSON
// source, `geometry-draw-tool.svelte:117-130`) and each vertex a draggable DOM marker, so adding or dragging a vertex
// re-draws the overlay source only and never a feature (R14). Colours are the caller's design tokens.
import type { Position } from '@ueberblick/core/geo';
import type { MapHandle, OverlayStyle, Unsubscribe } from '../contract';
import type { Part } from './model';
import type { DrawSession } from './session';

export interface DrawColors {
  /** The active part (v3 red-500). */
  readonly active: string;
  /** The other parts (v3 blue-500). */
  readonly idle: string;
}

const PART = 'draw-part-';
const VERTEX = 'draw-vertex-';

interface Shown {
  at: Position;
  active: boolean;
  first: boolean;
}

/** v3's vertex dot (`.geometry-draw-vertex`, :782-792): 10 px, white border, soft shadow; the first one is larger to be tapped. */
function dot(color: string, first: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ub-draw-vertex';
  el.dataset.testid = 'draw-vertex';
  const span = document.createElement('span');
  span.style.background = color;
  if (first) el.dataset.first = 'true';
  el.appendChild(span);
  return el;
}

function overlay(
  part: Part,
  polygon: boolean,
  active: boolean,
  colors: DrawColors,
): OverlayStyle | undefined {
  const n = part.points.length;
  const color = active ? colors.active : colors.idle;
  // an open outline is dashed until the ring is closed (:200-225); a line is drawn solid at once
  const style: OverlayStyle = { color, width: polygon ? (active ? 3 : 2) : active ? 4 : 3, opacity: 0.85 };
  if (polygon) return n >= 2 ? { ...style, dashed: !part.closed } : undefined;
  return n >= 2 ? style : undefined;
}

export interface DrawController {
  destroy(): void;
}

export function createDrawController(
  handle: MapHandle,
  session: DrawSession,
  colors: DrawColors,
): DrawController {
  const polygon = session.kind === 'polygon';
  const parts = new Set<number>();
  const vertices = new Map<string, Shown>();
  const stops: Unsubscribe[] = [];
  const cleanups: (() => void)[] = [];

  const vertexId = (part: number, i: number): string => `${VERTEX}${part}-${i}`;
  const parse = (id: string): [number, number] | undefined => {
    if (!id.startsWith(VERTEX)) return undefined;
    const [part, i] = id.slice(VERTEX.length).split('-').map(Number);
    return part === undefined || i === undefined ? undefined : [part, i];
  };

  function place(id: string, at: Position, active: boolean, first: boolean): void {
    const el = dot(active ? colors.active : colors.idle, first);
    const [part = 0, i = 0] = parse(id) ?? [];
    // the tap belongs to the vertex, not to the map underneath (v3 :415-420)
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      session.activate(part);
      if (i === 0) session.closeRing(part);
    });
    // a drag is one undo step: the first move records it, the release ends it
    el.addEventListener('pointerdown', () => {
      const end = (): void => {
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        session.endMove();
      };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      cleanups.push(end);
    });
    handle.addMarker(id, at, { element: el, draggable: true });
    vertices.set(id, { at, active, first });
  }

  function render(): void {
    const all = session.parts();
    const wanted = new Set<string>();
    all.forEach((part, p) => {
      const active = p === session.active();
      const style = overlay(part, polygon, active, colors);
      if (style === undefined) {
        handle.clearOverlay(PART + p);
        parts.delete(p);
      } else {
        const pts = part.points;
        handle.showOverlay(
          PART + p,
          polygon && pts.length >= 3
            ? { type: 'Polygon', coordinates: [[...pts, pts[0] as Position]] }
            : { type: 'LineString', coordinates: pts },
          style,
        );
        parts.add(p);
      }
      part.points.forEach((at, i) => {
        const id = vertexId(p, i);
        wanted.add(id);
        const old = vertices.get(id);
        if (old === undefined || old.active !== active) place(id, at, active, i === 0);
        else if (old.at[0] !== at[0] || old.at[1] !== at[1]) {
          handle.moveMarker(id, at);
          old.at = at;
        }
      });
    });
    for (const p of [...parts]) {
      if (p >= all.length) {
        handle.clearOverlay(PART + p);
        parts.delete(p);
      }
    }
    for (const id of [...vertices.keys()]) {
      if (!wanted.has(id)) {
        handle.removeMarker(id);
        vertices.delete(id);
      }
    }
  }

  stops.push(
    session.subscribe(render),
    handle.onMapTap((at) => session.add(at)),
    handle.onMarkerDrag((id, at) => {
      const key = parse(id);
      if (key === undefined) return;
      const old = vertices.get(id);
      if (old !== undefined) old.at = at; // the marker is already there: don't move it under the finger
      session.moveVertex(key[0], key[1], at);
    }),
  );
  render();

  return {
    destroy() {
      stops.forEach((s) => s());
      cleanups.forEach((f) => f());
      for (const id of vertices.keys()) handle.removeMarker(id);
      for (const p of parts) handle.clearOverlay(PART + p);
      vertices.clear();
      parts.clear();
    },
  };
}
