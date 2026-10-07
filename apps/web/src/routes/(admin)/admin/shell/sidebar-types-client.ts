/**
 * The browser side of the sidebar's two draft edits (WP-343): a new type and a new order. Both read the draft
 * (`GET /builder-api/<project>/draft`), apply the op to it with the builder's `Doc` (`sidebar-types.ts`) and write it back under the
 * revision they read (`PUT`, A-011); a stale answer (409) is read again once. Comments in the overlay stay.
 */
import { applyOps, openProject, type Op } from '@ueberblick/builder';
import type { TemplateFile } from '@ueberblick/core';
import { addTypeOp, newTypeEntry, orderTypesOp, typeKeyFor, type SidebarKind } from './sidebar-types';

/**
 * Applies ops to a draft the way the builder does (`openProject`, `applyOps`, `save`) and returns the new
 * overlay text (comments stay), or null when the draft does not open or an op is refused.
 */
export function editOverlay(templateSrc: string, overlaySrc: string, ops: readonly Op[]): string | null {
  try {
    const r = applyOps(openProject(templateSrc, overlaySrc), ops);
    return 'refused' in r ? null : r.doc.save().overlaySrc;
  } catch {
    return null;
  }
}

export type AddTypeResult = { readonly ok: true; readonly key: string } | { readonly ok: false };

/** The ops a wizard computed from the draft's effective file, and what it wants to know about them afterwards. */
export interface DraftEdit<T> {
  readonly ops: readonly Op[];
  readonly result: T;
}

export type ApplyResult<T> = { readonly ok: true; readonly result: T } | { readonly ok: false };

export interface TypeEditor {
  /** Adds a type named `name`; `taken` are the keys that exist, so the new key is unique. */
  addType(kind: SidebarKind, name: string, taken: readonly string[]): Promise<AddTypeResult>;
  /**
   * Applies ops that depend on the draft as it is when they are saved (keys that must be free, the GeoJSON wizard);
   * `build` runs again on a stale answer, so the result is the one of the edit that was saved.
   */
  apply<T>(build: (effective: TemplateFile) => DraftEdit<T>): Promise<ApplyResult<T>>;
  /** Sets the order of every type; false when it could not be saved. */
  reorder(keys: readonly string[]): Promise<boolean>;
}

interface DraftView {
  readonly template: string;
  readonly overlay: string;
  readonly revision: number;
}

export function createTypeEditor(opts: {
  readonly project: string;
  readonly fetch: typeof fetch;
}): TypeEditor {
  const url = `/builder-api/${opts.project}/draft`;

  /** The draft names its template (a key); the builder's `Doc` needs the source, which has its own route. */
  async function read(): Promise<DraftView | null> {
    try {
      const [res, tpl] = await Promise.all([
        opts.fetch(url),
        opts.fetch(`/admin/shell/template/${opts.project}`),
      ]);
      if (!res.ok || !tpl.ok) return null;
      const draft = (await res.json()) as { overlay: string; revision: number };
      const { templateSrc } = (await tpl.json()) as { templateSrc: string };
      return { template: templateSrc, overlay: draft.overlay, revision: draft.revision };
    } catch {
      return null;
    }
  }

  /** The HTTP status of the PUT, or 0 when the draft could not be read or the request failed. */
  async function write(edit: (draft: DraftView) => string | null): Promise<number> {
    const draft = await read();
    if (draft === null) return 0;
    const overlay = edit(draft);
    if (overlay === null) return 0;
    try {
      const res = await opts.fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ overlay, revision: draft.revision }),
      });
      return res.status;
    } catch {
      return 0;
    }
  }

  async function save(edit: (draft: DraftView) => string | null): Promise<boolean> {
    const first = await write(edit);
    const status = first === 409 ? await write(edit) : first; // stale: read again once
    return status >= 200 && status < 300;
  }

  return {
    async apply<T>(build: (effective: TemplateFile) => DraftEdit<T>): Promise<ApplyResult<T>> {
      let result: T | undefined;
      const ok = await save((d) => {
        try {
          const edit = build(openProject(d.template, d.overlay).effective());
          result = edit.result;
          return editOverlay(d.template, d.overlay, edit.ops);
        } catch {
          return null;
        }
      });
      return ok && result !== undefined ? { ok, result } : { ok: false };
    },
    async addType(kind, name, taken) {
      const key = typeKeyFor(name, taken);
      const ok = await save((d) =>
        editOverlay(d.template, d.overlay, [addTypeOp(key, newTypeEntry(kind, name))]),
      );
      return ok ? { ok, key } : { ok };
    },
    reorder: (keys) => save((d) => editOverlay(d.template, d.overlay, [orderTypesOp(keys)])),
  };
}
