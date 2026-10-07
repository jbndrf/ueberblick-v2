// The file tool (WP-658): v3's "Dateien" button (MediaGallery.svelte:303-336). A `field` tool producing a `file`
// value, the list `[{sha256, name, mime}]` (WP-603): the picked files are appended to the current list up to the
// property's `max_files`, each matched against its `accept`. The bytes go to the blob port (they travel with the
// run, WP-605); only the list leaves the tool. The file rows with their remove buttons are drawn by the gallery
// above the field (`packages/ui/src/form/gallery`), so this tool is the button and nothing else.
import {
  DEFAULT_MAX_FILES,
  defineTool,
  fileAccepted,
  type FieldTool,
  type FieldToolContext,
  type ToolHandle,
} from '@ueberblick/ui/tool-api';
import { message } from './messages';

/** v3 `acceptTypes` default when the property names no types (MediaGallery.svelte:55-57). */
export const V3_DEFAULT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

const STYLE = `
.ub-file{display:flex;flex-direction:column;gap:var(--ub-space-sm,8px)}
.ub-file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);opacity:0}
.ub-file-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:var(--ub-space-xs,4px);min-height:48px;min-width:48px;padding:0 var(--ub-space-md,16px);font:inherit;font-weight:var(--ub-type-weight-strong,600);color:var(--ub-color-text,#111);background:var(--ub-color-bg,#fff);border:2px solid var(--ub-color-border,#767676);border-radius:var(--ub-radius-md,8px);cursor:pointer;align-self:flex-start}
.ub-file-input:focus-visible+.ub-file-btn{outline:3px solid var(--ub-color-focus,#005fcc);outline-offset:2px}
.ub-file-input[aria-disabled=true]+.ub-file-btn{opacity:.6;cursor:default}
.ub-file-status{margin:0;font-size:var(--ub-type-size-sm,14px);color:var(--ub-color-text-muted,#555)}
.ub-file-status[data-error]{color:var(--ub-color-danger,#b00020);font-weight:var(--ub-type-weight-strong,600)}
`;
// v3's ImagePlus icon (lucide), inline so the tool pulls no design system.
const ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5h6M19 2v6M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></svg>';

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

function mountFile(root: HTMLElement, ctx: FieldToolContext): ToolHandle {
  const t = (k: Parameters<typeof message>[1]) => message(ctx.locale, k);
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
  const full = () => files().length >= maxFiles;

  const wrap = document.createElement('div');
  wrap.className = 'ub-file';
  const style = document.createElement('style');
  style.textContent = STYLE;
  const input = document.createElement('input');
  input.type = 'file';
  input.id = `${ctx.field.id}-files`;
  input.className = 'ub-file-input';
  input.accept = accept?.join(',') ?? V3_DEFAULT_ACCEPT;
  input.multiple = maxFiles > 1;
  const btn = document.createElement('label');
  btn.className = 'ub-file-btn';
  btn.htmlFor = input.id;
  btn.insertAdjacentHTML('afterbegin', ICON);
  btn.append(document.createTextNode(t('choose')));
  const status = document.createElement('p');
  status.className = 'ub-file-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let destroyed = false;

  function say(text: string, error = false) {
    status.textContent = text;
    if (error) status.setAttribute('data-error', '');
    else status.removeAttribute('data-error');
  }
  function sync(busy: boolean) {
    input.disabled = busy;
    input.setAttribute('aria-disabled', String(full()));
  }
  input.addEventListener('click', (e) => {
    if (!full()) return;
    e.preventDefault();
    say(t('limit'));
  });

  async function store(file: File): Promise<FileRef | undefined> {
    const mime = file.type !== '' ? file.type : 'application/octet-stream';
    const sha256 = await ctx.ports.hash.sha256(await file.arrayBuffer());
    const ref: FileRef = { sha256, name: file.name, mime };
    if (!fileAccepted(accept, ref)) return undefined;
    await ctx.ports.blobs.put(sha256, file, mime);
    return ref;
  }

  async function onPick() {
    const picked = Array.from(input.files ?? []);
    if (picked.length === 0 || full()) return;
    sync(true);
    say(t('processing'));
    try {
      const room = maxFiles - files().length;
      const added: FileRef[] = [];
      let refused = false;
      for (const file of picked.slice(0, room)) {
        const ref = await store(file);
        if (ref) added.push(ref);
        else refused = true;
      }
      if (destroyed) return;
      if (added.length > 0) {
        known = [...files(), ...added];
        ctx.produce(known.map((f) => ({ ...f })));
      }
      const over = picked.length > room;
      if (refused) say(t('not_accepted'), true);
      else say(full() || over ? `${t('done')}. ${t('limit')}` : t('done'));
    } catch {
      if (!destroyed) say(t('failed'), true);
    } finally {
      input.value = '';
      if (!destroyed) sync(false);
    }
  }
  input.addEventListener('change', () => void onPick());

  if (full()) say(t('limit'));
  sync(false);
  wrap.append(style, input, btn, status);
  root.append(wrap);
  return {
    destroy() {
      destroyed = true;
      wrap.remove();
    },
  };
}

export function createFileTool(): FieldTool {
  return defineTool({
    key: 'file',
    contributes: ['form-field'],
    produces: 'file',
    mount: (root, ctx) => mountFile(root, ctx),
  });
}
