// The fan of the children at their parent (B-019, v3 `family-stack-fan.ts`): "the reversed dropdown". The relation
// opened in the feature sheet fans its children out above the parent's marker: at most FAN_CAP icons (their own marker
// looks) and a "+N" chip for the rest. They are map markers of the handle, not features: never sent to the cluster
// worker, and at most FAN_CAP + 1 of them exist while a relation is open, so the cost is O(children of the opened
// parent), never O(features). The offsets are in screen pixels, so they are put again on every frame the view moves
// (v3 collapsed on pan and opened again at the end; the result for the person is the same, the fan stays glued).
// A tap on the empty map collapses it (v3 `collapse`).
import type { Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { MapHandle, Unsubscribe } from './contract';

/** Vertical gap between the fanned icons (v3 `FAN_GAP_PX`). */
const GAP_PX = 6;
/** Extra clearance between the parent icon's top and the first child (v3 `FAN_CLEARANCE_EXTRA_PX`). */
const CLEARANCE_PX = 14;
/** v3's "+N" chip: 34 x 22. */
const CHIP_W = 34;
const CHIP_H = 22;
/** A touch target is never smaller than this (docs/13); the visible chip and icons stay v3's size inside it. */
const TARGET_PX = 44;
const STAGGER_MS = 35;

/** A child's marker artwork as an image (the same drawing the map uses for it). */
export interface FanIcon {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface FanItem {
  readonly id: FeatureId;
  /** Names the child's button (its display name). */
  readonly label: string;
  readonly icon: FanIcon;
}

export interface FanOptions {
  readonly parent: FeatureId;
  /** The parent's anchor, WGS84. */
  readonly at: Position;
  /** How far the parent's icon reaches above its anchor, in px. */
  readonly parentIconHeight: number;
  readonly items: readonly FanItem[];
  /** How many children did not fit; the "+N" chip is drawn when above 0. */
  readonly overflow: number;
  readonly overflowLabel: string;
  readonly onChild: (id: FeatureId) => void;
  /** The chip: the parent's relation list. */
  readonly onOverflow: (parent: FeatureId) => void;
}

export interface FamilyFan {
  open(options: FanOptions): void;
  close(): void;
  isOpen(): boolean;
  /** The parent whose fan is open. */
  openParent(): FeatureId | undefined;
}

const MARKER_PREFIX = 'family-fan-';

/** The marker root (MapLibre positions it with `transform`) and the button inside it, which carries the pop-in animation. */
function target(
  onTap: () => void,
  label: string,
  w: number,
  h: number,
  delay: number,
): { readonly root: HTMLElement; readonly button: HTMLButtonElement } {
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', label);
  const outerW = Math.max(w, TARGET_PX);
  const outerH = Math.max(h, TARGET_PX);
  el.style.cssText = `display:flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;cursor:pointer;min-width:${outerW}px;min-height:${outerH}px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.3))`;
  // A tap on a fan item must not reach the map: it would collapse the fan or move a pin (v3 stopped the same events).
  for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup'])
    el.addEventListener(type, (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap();
  });
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && typeof el.animate === 'function')
    el.animate(
      [
        { opacity: 0, transform: 'translateY(8px) scale(.7)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 160, delay, easing: 'ease-out', fill: 'backwards' },
    );
  const root = document.createElement('div');
  root.appendChild(el);
  return { root, button: el };
}

export function createFamilyFan(handle: MapHandle): FamilyFan {
  let current: FanOptions | undefined;
  const placed: { id: string; offsetUp: number }[] = [];
  let stops: Unsubscribe[] = [];

  /** Puts each marker `offsetUp` px above the parent's anchor at the current zoom. */
  function reposition(): void {
    if (current === undefined) return;
    const base = handle.project(current.at);
    if (base === undefined) return;
    for (const p of placed) {
      const at = handle.unproject({ x: base.x, y: base.y - p.offsetUp });
      if (at !== undefined) handle.moveMarker(p.id, at);
    }
  }

  function close(): void {
    for (const s of stops) s();
    stops = [];
    for (const p of placed) handle.removeMarker(p.id);
    placed.length = 0;
    current = undefined;
  }

  function open(options: FanOptions): void {
    close();
    current = options;
    const base = handle.project(options.at);
    if (base === undefined) return;
    let cursor = options.parentIconHeight + CLEARANCE_PX;
    let index = 0;
    const put = (id: string, el: HTMLElement, h: number): void => {
      const offsetUp = cursor + h / 2; // the marker sits with its middle on its position
      const at = handle.unproject({ x: base.x, y: base.y - offsetUp });
      if (at === undefined) return;
      handle.addMarker(id, at, { element: el });
      placed.push({ id, offsetUp });
      cursor += h + GAP_PX;
      index++;
    };
    for (const [i, item] of options.items.entries()) {
      const { icon } = item;
      const { root, button } = target(
        () => options.onChild(item.id),
        item.label,
        icon.width,
        icon.height,
        index * STAGGER_MS,
      );
      const img = document.createElement('img');
      img.src = icon.url;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = `display:block;width:${icon.width}px;height:${icon.height}px;pointer-events:none`;
      button.appendChild(img);
      put(`${MARKER_PREFIX}${i}`, root, Math.max(icon.height, TARGET_PX));
    }
    if (options.overflow > 0) {
      const { root: chipRoot, button: chip } = target(
        () => options.onOverflow(options.parent),
        options.overflowLabel,
        CHIP_W,
        CHIP_H,
        index * STAGGER_MS,
      );
      const face = document.createElement('span');
      face.textContent = `+${options.overflow}`;
      face.style.cssText = `display:flex;align-items:center;justify-content:center;width:${CHIP_W}px;height:${CHIP_H}px;border-radius:9999px;background:#fff;border:1px solid #d1d5db;color:#374151;font-size:12px;font-weight:600;line-height:1`;
      chip.appendChild(face);
      put(`${MARKER_PREFIX}more`, chipRoot, TARGET_PX);
    }
    stops = [handle.onMove(reposition), handle.onMapTap(close)];
  }

  return { open, close, isOpen: () => current !== undefined, openParent: () => current?.parent };
}
