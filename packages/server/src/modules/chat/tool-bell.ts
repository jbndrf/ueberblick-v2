/**
 * The tool bell: the doorbell's second message kind (docs/07). `ring(project, tool)` says THAT a tool's stream moved, never
 * what (H5: `event: tool` carries the tool key only); the device answers with a pull of `tools/<tool>?after=`. One bell per
 * process; a listener hears one project. The sync events handler subscribes and writes the SSE event.
 */
export interface ToolBell {
  ring(projectKey: string, tool: string): void;
  /** Returns an unsubscribe function. */
  subscribe(projectKey: string, listener: (tool: string) => void): () => void;
}

export function createToolBell(): ToolBell {
  const listeners = new Map<string, Set<(tool: string) => void>>();
  return {
    ring(projectKey, tool) {
      for (const l of [...(listeners.get(projectKey) ?? [])]) l(tool);
    },
    subscribe(projectKey, listener) {
      let set = listeners.get(projectKey);
      if (set === undefined) listeners.set(projectKey, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(projectKey);
      };
    },
  };
}

/** The wire form of the event: `event: tool` with `{ tool }` and nothing else. */
export const toolEvent = (tool: string): string => `event: tool\ndata: ${JSON.stringify({ tool })}\n\n`;
