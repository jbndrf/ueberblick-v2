/**
 * The browser side of `/builder-api/<project>/layout` (WP-366): implements the canvas's `CanvasLayoutApi`
 * over `fetch`. The positions are stored next to the draft, so this client needs no draft saver.
 */

/**
 * The shape of the builder's `CanvasLayoutApi`, written out here because the participant bundle's import rule
 * keeps this file from importing the builder package (`participant-no-builder`); the page that passes it to
 * `setCanvasLayoutApi` checks it structurally.
 */
interface PlacedNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}
export interface LayoutClient {
  load(type: string): Promise<readonly PlacedNode[]>;
  save(type: string, nodes: readonly PlacedNode[]): Promise<void>;
}

export function createLayoutClient(opts: {
  readonly project: string;
  readonly fetch: typeof fetch;
}): LayoutClient {
  const url = `/builder-api/${opts.project}/layout`;
  return {
    async load(type) {
      const res = await opts.fetch(`${url}?type=${encodeURIComponent(type)}`);
      if (!res.ok) throw new Error(`layout: ${res.status}`);
      return ((await res.json()) as { nodes: readonly PlacedNode[] }).nodes;
    },
    async save(type, nodes) {
      const res = await opts.fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, nodes }),
      });
      if (!res.ok) throw new Error(`layout: ${res.status}`);
    },
  };
}
