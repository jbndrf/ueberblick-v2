/** Svelte action: moves the node to document.body so overlays escape clipped or transformed parents (v3 `portal`). */
export function portal(node: HTMLElement, enabled: boolean = true): { destroy(): void } {
  if (!enabled) return { destroy() {} };
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
