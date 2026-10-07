/** The slide of the module shell (`duration-300`, `ModuleShell.svelte`): a closed shell is on screen this long. */
export const SLIDE_MS = 300;

export interface SlideOut {
  /** True from the close until `done` ran: the shell is shown closed, so it slides out. */
  readonly leaving: boolean;
  /** Starts the slide-out; `done` (unmount) runs when it is over. A second call does nothing. */
  close(): void;
  /** Forgets the pending `done` (the host went away first). */
  cancel(): void;
}

/**
 * A host that unmounts its shell the moment it is closed kills the slide-out (v3 keeps the shell mounted and only flips
 * `isOpen`). The host closes the shell first and unmounts when the slide is over.
 */
export function slideOut(done: () => void, ms: number = SLIDE_MS): SlideOut {
  let leaving = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get leaving() {
      return leaving;
    },
    close() {
      if (leaving) return;
      leaving = true;
      timer = setTimeout(done, ms);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}
