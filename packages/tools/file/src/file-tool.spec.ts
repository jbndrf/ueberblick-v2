// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { createToolHost, webCryptoHash, type ToolField, type ToolPorts } from '@ueberblick/ui';
import { describeToolContract, testPorts } from '@ueberblick/ui/tool-testing';
import type { JsonValue } from '@ueberblick/core/model';
import { createFileTool } from './file-tool';

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

const field: ToolField = {
  key: 'anhang',
  id: 'f-anhang',
  label: 'Attachment',
  type: 'file',
  accept: ['application/pdf', '.docx'],
  maxFiles: 3,
};
const pdf = (name = 'plan.pdf') => new File(['%PDF-1.4 x'], name, { type: 'application/pdf' });

function setup(opts: { locale?: string; field?: ToolField; value?: JsonValue; putFails?: boolean } = {}) {
  const stored: { sha: string; mime: string }[] = [];
  const ports: ToolPorts = {
    ...testPorts(),
    hash: webCryptoHash,
    blobs: {
      put: async (sha, _b, mime) => {
        if (opts.putFails) throw new Error('disk');
        stored.push({ sha, mime });
      },
    },
  };
  const host = createToolHost({
    loaders: { file: async () => createFileTool() },
    ports,
    ...(opts.locale ? { locale: opts.locale } : {}),
    optionsFor: () => ({}),
  });
  const root = document.createElement('div');
  document.body.append(root);
  const onproduce = vi.fn();
  const mounted = host.mountField(root, {
    toolKey: 'file',
    field: opts.field ?? field,
    value: opts.value,
    onproduce,
    onclear: vi.fn(),
  });
  return { root, stored, onproduce, mounted };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describeToolContract({
  name: 'file',
  tool: () => createFileTool(),
  field,
  drive: async (root) => {
    const input = must(root.querySelector<HTMLInputElement>('input[type=file]'));
    await userEvent.setup().upload(input, pdf());
    await vi.waitFor(() => expect(root.textContent).toContain('Added'));
  },
});

describe('file tool (v3 "Dateien" button)', () => {
  it('shows one Files button and no camera button; the input offers the property accept, multiple when max_files > 1', async () => {
    const t = setup();
    await t.mounted;
    const inputs = t.root.querySelectorAll<HTMLInputElement>('input[type=file]');
    expect(inputs).toHaveLength(1);
    const input = must(inputs[0]);
    expect(input.getAttribute('accept')).toBe('application/pdf,.docx');
    expect(input.hasAttribute('capture')).toBe(false);
    expect(input.multiple).toBe(true);
    expect(must(input.labels?.[0]).textContent).toBe('Files');
  });

  it('is single-select at max_files 1 and speaks German', async () => {
    const t = setup({ locale: 'de', field: { ...field, maxFiles: 1 } });
    await t.mounted;
    const input = must(t.root.querySelector<HTMLInputElement>('input[type=file]'));
    expect(input.multiple).toBe(false);
    expect(t.root.textContent).toContain('Dateien');
  });

  it('without accept it offers v3 default image types (v3 acceptTypes)', async () => {
    const bare: ToolField = { key: field.key, id: field.id, label: field.label, type: field.type };
    const t = setup({ field: bare });
    await t.mounted;
    expect(must(t.root.querySelector('input')).getAttribute('accept')).toBe(
      'image/png,image/jpeg,image/webp,image/gif',
    );
  });

  it('stores the bytes with the run and produces {sha256, name, mime}, appended to the list', async () => {
    const old = { sha256: 'a'.repeat(64), name: 'old.pdf', mime: 'application/pdf' };
    const t = setup({ value: [old] });
    await t.mounted;
    await userEvent.setup().upload(must(t.root.querySelector('input')), pdf());
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalled());
    const sha = await webCryptoHash.sha256(await pdf().arrayBuffer());
    expect(t.onproduce).toHaveBeenCalledWith([
      old,
      { sha256: sha, name: 'plan.pdf', mime: 'application/pdf' },
    ]);
    expect(t.stored).toEqual([{ sha, mime: 'application/pdf' }]);
  });

  it('several files at once, cut at max_files with the limit message', async () => {
    const t = setup({ field: { ...field, maxFiles: 2 } });
    await t.mounted;
    await userEvent
      .setup()
      .upload(must(t.root.querySelector('input')), [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
    await vi.waitFor(() => expect(t.onproduce).toHaveBeenCalled());
    const list = must(t.onproduce.mock.calls[0])[0] as { name: string }[];
    expect(list.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(must(t.root.querySelector('[role=status]')).textContent).toContain('limit');
  });

  it('refuses a type the property does not accept and writes nothing', async () => {
    const t = setup();
    await t.mounted;
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        must(t.root.querySelector('input')),
        new File(['x'], 'a.exe', { type: 'application/x-msdownload' }),
      );
    await vi.waitFor(() => expect(t.root.querySelector('[data-error]')).not.toBeNull());
    expect(t.onproduce).not.toHaveBeenCalled();
    expect(t.stored).toEqual([]);
  });

  it('adds nothing at max_files, and says so', async () => {
    const value = ['1', '2', '3'].map((n) => ({
      sha256: n.repeat(64),
      name: `${n}.pdf`,
      mime: 'application/pdf',
    }));
    const t = setup({ value });
    await t.mounted;
    const input = must(t.root.querySelector<HTMLInputElement>('input'));
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(must(t.root.querySelector('[role=status]')).textContent).toContain('limit');
    await userEvent.setup().upload(input, pdf());
    expect(t.onproduce).not.toHaveBeenCalled();
  });

  it('a failing store shows an error and produces nothing', async () => {
    const t = setup({ putFails: true });
    await t.mounted;
    await userEvent.setup().upload(must(t.root.querySelector('input')), pdf());
    await vi.waitFor(() => expect(t.root.querySelector('[data-error]')).not.toBeNull());
    expect(t.onproduce).not.toHaveBeenCalled();
    expect(must(t.root.querySelector<HTMLInputElement>('input')).disabled).toBe(false);
  });

  it('is keyboard-reachable and axe-clean', async () => {
    const t = setup();
    await t.mounted;
    await userEvent.setup().tab();
    expect(document.activeElement?.tagName).toBe('INPUT');
    const res = await axe.run(t.root, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});
