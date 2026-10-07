// The photo tool (WP-527): a `field` tool producing a `file` value: the list `[{sha256, name, mime}]` (WP-603), each
// photo appended to the current list up to the property's `max_files`, matched against its `accept`. The
// bytes go to the blob port; only this list leaves the tool.
import {
  DEFAULT_MAX_FILES,
  defineTool,
  fileAccepted,
  type FieldTool,
  type FieldToolContext,
  type ToolHandle,
} from '@ueberblick/ui/tool-api';
import { BUILTIN_TOOL_SCHEMAS } from '@ueberblick/core/registry/tools';
import { message } from './messages';
import { readPhotoOptions } from './pipeline';
import type { ImageProcessor } from './worker-client';

const STYLE = `
.ub-photo{display:flex;flex-direction:column;gap:var(--ub-space-sm,8px)}
.ub-photo-row{display:flex;flex-wrap:wrap;gap:var(--ub-space-sm,8px)}
.ub-photo-input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);opacity:0}
.ub-photo-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px;padding:0 var(--ub-space-md,16px);font:inherit;font-size:var(--ub-type-size-sm,14px);font-weight:500;color:var(--ub-color-text,#111);background:var(--ub-color-bg,#fff);border:1px solid var(--ub-color-border,#767676);border-radius:var(--ub-radius-md,8px);box-shadow:0 1px 2px 0 rgb(0 0 0/.05);cursor:pointer}\n.ub-photo-btn:hover{background:color-mix(in srgb,var(--ub-color-text,#111) 8%,var(--ub-color-bg,#fff))}\n.ub-photo-icon{width:16px;height:16px;flex:none}
.ub-photo-input:focus-visible+.ub-photo-btn,.ub-photo-btn:focus-visible{outline:3px solid var(--ub-color-focus,#005fcc);outline-offset:2px}
.ub-photo-btn[aria-disabled=true]{opacity:.6;cursor:default}
.ub-photo-status{margin:0;font-size:var(--ub-type-size-sm,14px);color:var(--ub-color-text-muted,#555)}
.ub-photo-status:not([data-visible]){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ub-photo-status[data-error]{color:var(--ub-color-danger,#b00020);font-weight:var(--ub-type-weight-strong,600)}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  return node;
}

// v3 drew Lucide Camera / ImagePlus beside the label (MediaGallery.svelte:303-312); the tool draws them itself.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  camera: [
    [
      'path',
      {
        d: 'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z',
      },
    ],
    ['circle', { cx: '12', cy: '13', r: '3' }],
  ],
  imagePlus: [
    ['path', { d: 'M16 5h6' }],
    ['path', { d: 'M19 2v6' }],
    ['path', { d: 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
  ],
} as const;

function icon(name: keyof typeof ICONS): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    class: 'ub-photo-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of ICONS[name]) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) shape.setAttribute(k, v);
    svg.append(shape);
  }
  return svg;
}

function baseName(name: string): string {
  const stem = name.replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_');
  return stem.length > 0 ? stem : 'photo';
}

interface FileRef {
  readonly sha256: string;
  readonly name: string;
  readonly mime: string;
}

const isFileRef = (v: unknown): v is FileRef =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as FileRef).sha256 === 'string' &&
  typeof (v as FileRef).name === 'string' &&
  typeof (v as FileRef).mime === 'string';

function currentFiles(value: unknown): FileRef[] {
  const out: FileRef[] = [];
  if (Array.isArray(value))
    for (const v of value as unknown[])
      if (isFileRef(v)) out.push({ sha256: v.sha256, name: v.name, mime: v.mime });
  return out;
}

function mountPhoto(root: HTMLElement, ctx: FieldToolContext, processor: ImageProcessor): ToolHandle {
  const t = (k: Parameters<typeof message>[1]) => message(ctx.locale, k);
  const options = readPhotoOptions(ctx.options);
  const accept = ctx.field.accept;
  const maxFiles = ctx.field.maxFiles ?? DEFAULT_MAX_FILES;
  // The gallery above the field removes entries from the value; `ctx.value` is live, so read it again when it changed.
  let seen = ctx.value;
  let known: readonly FileRef[] = currentFiles(seen);
  const files = (): readonly FileRef[] => {
    if (ctx.value !== seen) {
      seen = ctx.value;
      known = currentFiles(seen);
    }
    return known;
  };
  const wrap = el('div', { class: 'ub-photo' });
  const style = el('style', { textContent: STYLE });
  const row = el('div', { class: 'ub-photo-row' });
  const status = el('p', { class: 'ub-photo-status' });
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let destroyed = false;

  const inputs: HTMLInputElement[] = [];
  function picker(id: string, label: string, capture: boolean, glyph: keyof typeof ICONS) {
    const input = el('input', {
      class: 'ub-photo-input',
      id,
      type: 'file',
      accept: accept?.join(',') ?? 'image/*',
    });
    if (capture) input.setAttribute('capture', 'environment');
    // v3: only the gallery input is `multiple`, and only when more than one file fits (MediaGallery.svelte:333); the camera takes one shot.
    else input.multiple = maxFiles > 1;
    const btn = el('label', { class: 'ub-photo-btn' });
    btn.append(icon(glyph), document.createTextNode(label));
    btn.htmlFor = id;
    input.addEventListener('change', () => void onFile(input));
    input.addEventListener('click', (e) => {
      if (!full()) return;
      e.preventDefault();
      say(t('limit'), false, true);
    });
    inputs.push(input);
    row.append(input, btn);
  }
  // The tool makes JPEGs: no camera button when the property would not accept one (v3 `acceptsImages`).
  if (fileAccepted(accept, { name: 'photo.jpg', mime: 'image/jpeg' }))
    picker(`${ctx.field.id}-take`, t('take'), true, 'camera');
  picker(`${ctx.field.id}-choose`, t('choose'), false, 'imagePlus');

  // v3 showed no status text: success and progress are for screen readers only; errors and the limit stay visible.
  function say(text: string, error = false, visible = error) {
    status.textContent = text;
    if (visible) status.setAttribute('data-visible', '');
    else status.removeAttribute('data-visible');
    if (error) status.setAttribute('data-error', '');
    else status.removeAttribute('data-error');
  }
  const full = () => files().length >= maxFiles;
  function busy(on: boolean) {
    for (const i of inputs) {
      i.disabled = on;
      i.setAttribute('aria-disabled', String(full()));
    }
  }

  // One file through the pipeline (resize, hash, store); false when it failed or was not accepted.
  async function addOne(file: File): Promise<boolean> {
    try {
      const out = await processor.process(file, options);
      const buffer = await out.blob.arrayBuffer();
      const sha256 = await ctx.ports.hash.sha256(buffer);
      await ctx.ports.blobs.put(sha256, out.blob, 'image/jpeg');
      if (destroyed) return false;
      const ref: FileRef = { sha256, name: `${baseName(file.name)}.jpg`, mime: 'image/jpeg' };
      if (!fileAccepted(accept, ref)) {
        say(t('not_accepted'), true);
        return false;
      }
      known = [...files(), ref];
      ctx.produce(known.map((f) => ({ ...f })));
      return true;
    } catch {
      if (!destroyed) say(t('failed'), true);
      return false;
    }
  }

  // v3 (FieldRenderer.svelte:349-353) keeps the first `remaining` files of a multi-pick and drops the rest silently.
  // The files go through the pipeline one after another, so a cheap phone never decodes them all at once.
  async function onFile(input: HTMLInputElement) {
    const picked = Array.from(input.files ?? []);
    const batch = picked.slice(0, Math.max(0, maxFiles - files().length));
    if (batch.length === 0) {
      input.value = '';
      return;
    }
    busy(true);
    say(t('processing'));
    let ok = true;
    for (const file of batch) {
      if (destroyed) break;
      ok = (await addOne(file)) && ok;
    }
    input.value = '';
    if (destroyed) return;
    if (ok) {
      if (full()) say(`${t('done')}. ${t('limit')}`, false, true);
      else say(t('done'));
    }
    busy(false);
  }

  if (full()) say(t('limit'), false, true);
  busy(false);

  wrap.append(style, row, status);
  root.append(wrap);
  return {
    destroy() {
      destroyed = true;
      wrap.remove();
    },
  };
}

export function createPhotoTool(deps: { readonly processor: ImageProcessor }): FieldTool {
  return defineTool({
    key: 'photo',
    contributes: ['form-field'],
    settings: BUILTIN_TOOL_SCHEMAS.photo.settings,
    produces: 'file',
    mount: (root, ctx) => mountPhoto(root, ctx, deps.processor),
  });
}
