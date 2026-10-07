/**
 * The style renderer registry (H1). The lens knows no renderer: what a layer's `style` is, which
 * controls edit it and how it is validated belong to the renderer's entry. `maplibre-2d` is one
 * entry; a 3D renderer is another `register`, with no change to the lens. The style is opaque data
 * to the lens (`views.<v>.layers.<l>.style`), written through `Doc.apply` like any other value.
 */
import type { Json, LocalizedString } from '@ueberblick/core';
import { maplibre2d } from './maplibre-2d';

/** A style as stored: an object whose format the renderer owns. */
export type StyleValue = { readonly [key: string]: Json };

export interface StyleIssue {
  readonly message: string;
  /** The style layer at fault, when the renderer has layers. */
  readonly layerId?: string;
}

/** One declarative control of the style editor: a colour or a number. */
export interface StyleControl {
  readonly key: string;
  readonly kind: 'color' | 'number';
  readonly label: LocalizedString;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** The current fixed value; undefined when the style sets it by an expression or not at all. */
  read(style: StyleValue): string | number | undefined;
  /** A new style with the value set; never mutates `style`. */
  write(style: StyleValue, value: string | number): StyleValue;
}

export interface StyleRenderer {
  /** The renderer's registry key (`RENDERERS`, core), as in `layers.<l>.renderer`. */
  readonly key: string;
  readonly label: LocalizedString;
  /** The style a layer gets when the admin starts to customise it. */
  defaultStyle(): StyleValue;
  readonly controls: readonly StyleControl[];
  /** Async so a renderer may load its validator on demand. */
  validate(style: StyleValue): Promise<readonly StyleIssue[]>;
}

export interface StyleRendererRegistry {
  /** Adds a renderer; throws when the key is taken. */
  register(renderer: StyleRenderer): void;
  get(key: string): StyleRenderer | undefined;
  all(): readonly StyleRenderer[];
}

export function createStyleRendererRegistry(initial: readonly StyleRenderer[] = []): StyleRendererRegistry {
  const byKey = new Map<string, StyleRenderer>();
  const registry: StyleRendererRegistry = {
    register(renderer) {
      if (byKey.has(renderer.key)) throw new Error(`Style renderer ${renderer.key} is already registered.`);
      byKey.set(renderer.key, renderer);
    },
    get: (key) => byKey.get(key),
    all: () => [...byKey.values()],
  };
  for (const r of initial) registry.register(r);
  return registry;
}

/** The renderers every builder has. */
export function defaultStyleRenderers(): StyleRendererRegistry {
  return createStyleRendererRegistry([maplibre2d]);
}
