// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import {
  createToolHost,
  themeVars,
  THEMES,
  webCryptoHash,
  type ToolField,
  type ToolPorts,
} from '@ueberblick/ui';
import { describeToolContract, testPorts } from '@ueberblick/ui/tool-testing';
import { createPhotoTool } from './photo-tool';
import type { ImageProcessor } from './worker-client';
import type { JsonValue } from '@ueberblick/core/model';
import { jpeg } from './testing';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}

// jsdom's Blob has no arrayBuffer(); browsers do. Test-only shim.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

const field: ToolField = { key: 'foto', id: 'f-foto', label: 'Photo', type: 'file' };
const bytes = jpeg({ scan: 64 });

function setup(
  opts: {
    options?: Record<string, never>;
    fail?: boolean;
    locale?: string;
    field?: ToolField;
    value?: JsonValue;
  } = {},
) {
  const stored: { sha: string; mime: string; size: number }[] = [];
  const ports: ToolPorts = {
    ...testPorts(),
    hash: webCryptoHash,
    blobs: { put: async (sha, b, mime) => void stored.push({ sha, mime, size: b.size }) },
  };
  const process = vi.fn<ImageProcessor['process']>(async () => {
    if (opts.fail) throw new Error('decode');
    return { blob: new Blob([bytes], { type: 'image/jpeg' }), width: 10, height: 10 };
  });
  const host = createToolHost({
    loaders: { photo: async () => createPhotoTool({ processor: { process } }) },
    ports,
    ...(opts.locale ? { locale: opts.locale } : {}),
    optionsFor: () => opts.options ?? {},
  });
  const root = document.createElement('div');
  document.body.append(root);
  const onproduce = vi.fn();
  const mounted = host.mountField(root, {
    toolKey: 'photo',
    field: opts.field ?? field,
    value: opts.value,
    onproduce,
    onclear: vi.fn(),
  });
  return { root, process, stored, onproduce, mounted };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('photo tool', () => {
  it('picks a file, processes it, writes the bytes and produces {sha256, name, mime}', async () => {
    const t = setup({ options: { maxEdge: 1024 } as never });
    await t.mounted;
    const input = must(t.root.querySelector<HTMLInputElement>('#f-foto-choose'));
    await userEvent.setup().upload(input, new File(['raw'], 'My Tree.HEIC.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalled());
    const sha = await webCryptoHash.sha256(bytes.buffer as ArrayBuffer);
    expect(t.onproduce).toHaveBeenCalledWith([{ sha256: sha, name: 'My_Tree.HEIC.jpg', mime: 'image/jpeg' }]);
    expect(t.stored).toEqual([{ sha, mime: 'image/jpeg', size: bytes.length }]);
    expect(must(t.process.mock.calls[0])[1]).toMatchObject({ maxEdge: 1024, allowLocation: false });
    expect(must(t.root.querySelector('[role=status]')).textContent).toContain('Photo added');
  });

  it('several photos picked at once are added in order, one after another', async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const t = setup();
    t.process.mockImplementation(async (f: Blob) => {
      running++;
      peak = Math.max(peak, running);
      order.push((f as File).name);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { blob: new Blob([bytes], { type: 'image/jpeg' }), width: 10, height: 10 };
    });
    await t.mounted;
    const input = must(t.root.querySelector<HTMLInputElement>('#f-foto-choose'));
    expect(input.multiple).toBe(true);
    const jpg = (n: string) => new File([n], `${n}.jpg`, { type: 'image/jpeg' });
    await userEvent.setup().upload(input, [jpg('a'), jpg('b')]);
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalledTimes(2));
    expect(order).toEqual(['a.jpg', 'b.jpg']);
    expect(peak).toBe(1);
    const last = must(t.onproduce.mock.calls[1])[0] as { name: string }[];
    expect(last.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('over the limit keeps the first files that fit and drops the rest (v3 slice(0, remaining))', async () => {
    const t = setup({ field: { ...field, maxFiles: 2 } });
    await t.mounted;
    const input = must(t.root.querySelector<HTMLInputElement>('#f-foto-choose'));
    const jpg = (n: string) => new File([n], `${n}.jpg`, { type: 'image/jpeg' });
    await userEvent.setup().upload(input, [jpg('a'), jpg('b'), jpg('c')]);
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalledTimes(2));
    expect(t.process).toHaveBeenCalledTimes(2);
    const last = must(t.onproduce.mock.calls[1])[0] as { name: string }[];
    expect(last.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('a single-photo field has no multiple; the camera input never has', async () => {
    const t = setup({ field: { ...field, maxFiles: 1 } });
    await t.mounted;
    for (const id of ['#f-foto-choose', '#f-foto-take'])
      expect(must(t.root.querySelector<HTMLInputElement>(id)).multiple).toBe(false);
    const many = setup();
    await many.mounted;
    expect(must(many.root.querySelector<HTMLInputElement>('#f-foto-take')).multiple).toBe(false);
  });

  it('offers the camera through the capture input', async () => {
    const t = setup();
    await t.mounted;
    const take = must(t.root.querySelector('#f-foto-take'));
    expect(take.getAttribute('capture')).toBe('environment');
    expect(take.getAttribute('accept')).toBe('image/*');
    expect(must(t.root.querySelector('#f-foto-choose')).hasAttribute('capture')).toBe(false);
  });

  it('a field can allow location', async () => {
    const t = setup({ options: { allowLocation: true } as never });
    await t.mounted;
    await userEvent
      .setup()
      .upload(must(t.root.querySelector('#f-foto-choose')), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await vi.waitFor(() => expect(t.process).toHaveBeenCalled());
    expect(must(t.process.mock.calls[0])[1].allowLocation).toBe(true);
  });

  it('a failing image shows an alert-style message and produces nothing', async () => {
    const t = setup({ fail: true });
    await t.mounted;
    await userEvent
      .setup()
      .upload(must(t.root.querySelector('#f-foto-choose')), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await vi.waitFor(() => expect(t.root.querySelector('[data-error]')).not.toBeNull());
    expect(t.onproduce).not.toHaveBeenCalled();
    expect(must(t.root.querySelector<HTMLInputElement>('#f-foto-choose')).disabled).toBe(false);
  });

  it('works keyboard-only: native file inputs are focusable, labelled, and axe is clean', async () => {
    const t = setup();
    await t.mounted;
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.id).toBe('f-foto-take');
    await user.tab();
    expect(document.activeElement?.id).toBe('f-foto-choose');
    const label = (id: string) =>
      must(must(document.querySelector<HTMLInputElement>(id)).labels?.[0]).textContent;
    expect(label('#f-foto-take')).toBe('Take photo');
    expect(label('#f-foto-choose')).toBe('Choose photo');
    const res = await axe.run(t.root, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });

  it('speaks German', async () => {
    const t = setup({ locale: 'de' });
    await t.mounted;
    expect(t.root.textContent).toContain('Foto aufnehmen');
  });

  it('shows no file-name line for an existing value (v3 MediaGallery had none) and removes itself on destroy', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const tool = createPhotoTool({ processor: { process: vi.fn() } });
    const handle = tool.mount(root, {
      field,
      locale: 'en',
      value: [{ sha256: 'a'.repeat(64), name: 'old.jpg', mime: 'image/jpeg' }],
      options: {},
      settings: {},
      preferences: {},
      setPreference: () => {},
      ports: testPorts(),
      produce: () => {},
      clear: () => {},
    });
    expect(root.textContent).not.toContain('old.jpg');
    expect(root.textContent).not.toContain('Current photo');
    expect(must(root.querySelector('[role=status]')).textContent).toBe('');
    for (const width of [390, 1280]) {
      window.innerWidth = width;
      const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
      expect(res.violations.map((v) => v.id)).toEqual([]);
    }
    handle.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('announces success to screen readers without the file name, in a hidden live region', async () => {
    const t = setup();
    await t.mounted;
    await userEvent
      .setup()
      .upload(
        must(t.root.querySelector<HTMLInputElement>('#f-foto-choose')),
        new File(['x'], 'secret-name.jpg', { type: 'image/jpeg' }),
      );
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalled());
    const status = must(t.root.querySelector<HTMLElement>('[role=status]'));
    expect(status.textContent).toBe('Photo added');
    expect(status.hasAttribute('data-visible')).toBe(false);
  });
});

describe('photo tool: a list value', () => {
  const old = (n: number): JsonValue =>
    Array.from({ length: n }, (_, i) => ({
      sha256: String(i).repeat(64).slice(0, 64),
      name: `old${String(i)}.jpg`,
      mime: 'image/jpeg',
    }));
  const pick = async (root: HTMLElement, file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })) =>
    userEvent.setup().upload(must(root.querySelector<HTMLInputElement>('#f-foto-choose')), file);

  it('appends to the existing list', async () => {
    const t = setup({ value: old(2) });
    await t.mounted;
    await pick(t.root);
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalled());
    const list = must(t.onproduce.mock.calls[0])[0] as { name: string }[];
    expect(list.map((f) => f.name)).toEqual(['old0.jpg', 'old1.jpg', 'new.jpg']);
  });

  it('a second photo in one session keeps the first', async () => {
    const t = setup();
    await t.mounted;
    await pick(t.root);
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalledTimes(1));
    await pick(t.root, new File(['y'], 'two.jpg', { type: 'image/jpeg' }));
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalledTimes(2));
    expect((must(t.onproduce.mock.calls[1])[0] as unknown[]).length).toBe(2);
  });

  it('adds nothing at max_files, and says so', async () => {
    const t = setup({ value: old(2), field: { ...field, maxFiles: 2 } });
    await t.mounted;
    const choose = must(t.root.querySelector<HTMLInputElement>('#f-foto-choose'));
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(must(t.root.querySelector('[role=status]')).textContent).toContain('limit');
    await pick(t.root);
    expect(t.process).not.toHaveBeenCalled();
    expect(t.onproduce).not.toHaveBeenCalled();
  });

  it('defaults max_files to 10', async () => {
    const t = setup({ value: old(10) });
    await t.mounted;
    expect(must(t.root.querySelector('#f-foto-take')).getAttribute('aria-disabled')).toBe('true');
  });

  it('offers no camera when the property accepts no JPEG, and still the file picker', async () => {
    const t = setup({ field: { ...field, accept: ['image/png'] } });
    await t.mounted;
    expect(t.root.querySelector('#f-foto-take')).toBeNull();
    expect(t.root.querySelector('#f-foto-choose')).not.toBeNull();
  });

  it('reads the live value: after the gallery removes a file, the next photo is appended to what is left', async () => {
    const root = document.createElement('div');
    const tool = createPhotoTool({
      processor: {
        process: async () => ({ blob: new Blob([bytes], { type: 'image/jpeg' }), width: 1, height: 1 }),
      },
    });
    const produced: { name: string }[][] = [];
    const ctx = {
      field: { ...field, maxFiles: 2 },
      locale: 'en',
      value: old(2),
      options: {},
      settings: {},
      preferences: {},
      setPreference: () => {},
      ports: { ...testPorts(), hash: webCryptoHash, blobs: { put: async () => {} } },
      produce: (v: JsonValue) => void produced.push(v as { name: string }[]),
      clear: () => {},
    };
    tool.mount(root, ctx);
    document.body.append(root);
    await pick(root); // full: nothing
    expect(produced).toEqual([]);
    ctx.value = (old(2) as unknown[]).slice(1) as JsonValue; // the gallery removed old0
    await pick(root);
    await vi.waitFor(() => expect(produced).toHaveLength(1));
    expect(must(produced[0]).map((f) => f.name)).toEqual(['old1.jpg', 'new.jpg']);
  });

  it('uses the property accept for the pickers and refuses a result that does not match', async () => {
    const t = setup({ field: { ...field, accept: ['.png'] } });
    await t.mounted;
    expect(must(t.root.querySelector('#f-foto-choose')).getAttribute('accept')).toBe('.png');
    await pick(t.root, new File(['x'], 'new.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(t.root.querySelector('[data-error]')).not.toBeNull());
    expect(t.onproduce).not.toHaveBeenCalled();
  });

  it('accepts the photo when the property accept lists image/jpeg', async () => {
    const t = setup({ field: { ...field, accept: ['image/jpeg'] } });
    await t.mounted;
    await pick(t.root);
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalled());
  });
});

describeToolContract({
  name: 'photo',
  tool: () =>
    createPhotoTool({
      processor: {
        process: async () => ({ blob: new Blob([bytes], { type: 'image/jpeg' }), width: 10, height: 10 }),
      },
    }),
  field,
  ports: testPorts({ hash: webCryptoHash }),
  drive: async (root) => {
    const input = must(root.querySelector<HTMLInputElement>('#f-foto-choose'));
    await userEvent.setup().upload(input, new File(['raw'], 'a.jpg', { type: 'image/jpeg' }));
    await vi.waitFor(() => expect(root.textContent).toContain('Photo added'));
  },
});

// WP-728: the tool draws v3's two buttons itself (MediaGallery.svelte:303-312), no app CSS reaches into its DOM.
describe('photo tool buttons', () => {
  const cases = [
    ['#f-foto-take', 'Take photo', 'circle[cx="12"][cy="13"]'],
    ['#f-foto-choose', 'Choose photo', 'circle[cx="9"][cy="9"]'],
  ] as const;
  for (const [id, text, shape] of cases) {
    it(`${id} is an outline button: own icon, label, 44 px target`, async () => {
      const t = setup();
      await t.mounted;
      const btn = must(t.root.querySelector<HTMLElement>(`label[for="${id.slice(1)}"]`));
      const icon = must(btn.querySelector('svg'));
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.querySelector(shape)).not.toBeNull();
      expect(btn.textContent).toBe(text);
      const css = getComputedStyle(btn);
      expect(parseFloat(css.minHeight)).toBeGreaterThanOrEqual(44);
      // jsdom drops a shorthand holding var(); read the rule itself
      expect(must(t.root.querySelector('style')).textContent).toMatch(
        /\.ub-photo-btn\{[^}]*border:1px solid/,
      );
    });
  }

  it('styles only through theme variables', async () => {
    const t = setup();
    await t.mounted;
    const css = must(t.root.querySelector('style')).textContent ?? '';
    expect(css).toContain('var(--ub-');
    expect(css).not.toMatch(/var\(--(?!ub-)/);
  });

  it('uses only tokens the themes define (no fallback-only tokens)', async () => {
    const t = setup();
    await t.mounted;
    const css = must(t.root.querySelector('style')).textContent ?? '';
    const used = new Set([...css.matchAll(/var\((--ub-[a-z0-9-]+)/g)].map((m) => m[1] ?? ''));
    expect(used.size).toBeGreaterThan(0);
    for (const theme of Object.values(THEMES)) {
      const defined = themeVars(theme);
      for (const name of used) expect(Object.keys(defined), name).toContain(name);
    }
  });
});
