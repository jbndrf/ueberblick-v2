/** jsdom has no layout engine: stub the browser APIs bits-ui probes at mount. Import for effect. */
class TaskNoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = TaskNoopObserver as unknown as typeof ResizeObserver;
}

if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof matchMedia;
}

if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

// `animate:flip` of the form editor asks the element for its running animations
if (typeof Element.prototype.getAnimations === 'undefined') {
  Element.prototype.getAnimations = () => [];
}

export {};
