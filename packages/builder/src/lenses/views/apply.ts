/** The lens's one way to send an edit: through `Doc.apply` first, so a refusal stays visible in the form. */
import type { Doc, Op } from '../../doc';
import { defaultStyleRenderers, type StyleRendererRegistry } from './renderers';

export type ApplyOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Hands `op` to the shell only when the document takes it; a no-op op is silently fine. */
export function tryApply(doc: Doc, op: Op, onapply: (op: Op) => void): ApplyOutcome {
  const r = doc.apply(op);
  if (r.refused !== undefined) return { ok: false, message: r.refused.message };
  if (r.doc !== doc) onapply(op);
  return { ok: true };
}

/** The keys of a new view or layer are key path segments (docs/05). */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

let renderers: StyleRendererRegistry | undefined;

/** The seam for further renderers (H1): the app registers a 3D renderer's editor once, here. */
export function provideStyleRenderers(registry: StyleRendererRegistry | undefined): void {
  renderers = registry;
}

export function currentStyleRenderers(): StyleRendererRegistry {
  renderers ??= defaultStyleRenderers();
  return renderers;
}
