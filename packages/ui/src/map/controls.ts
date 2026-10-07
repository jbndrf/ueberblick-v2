// Helpers of the map (no zoom buttons: v3 has none). No literal text: the app passes the labels (Paraglide).
import type { MapDescriptionLabels } from './contract';

/** Zoom of "my position": v3's `toMapZoom(16)`, 16 in its 256 px tile numbering, 15 in MapLibre's 512 px one. */
export const POSITION_ZOOM = 15;

let counter = 0;

/**
 * Gives the map element an accessible name and a description that points to the list alternative
 * (WCAG 4.1.2). Returns a function that removes both again.
 */
export function describeMap(
  el: HTMLElement,
  labels: Pick<MapDescriptionLabels, 'map' | 'mapDescription'>,
): () => void {
  const id = `ub-map-description-${++counter}`;
  const description = el.ownerDocument.createElement('span');
  description.id = id;
  description.hidden = true;
  description.textContent = labels.mapDescription;
  el.append(description);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', labels.map);
  el.setAttribute('aria-describedby', id);
  return () => {
    description.remove();
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.removeAttribute('aria-describedby');
  };
}
