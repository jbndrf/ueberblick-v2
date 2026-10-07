// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { JsonValue, Property } from '@ueberblick/core/model';
import ToolMount from './ToolMount.svelte';
import { createToolHost, webCryptoHash } from './host';
import type { FieldTool } from './contract';
import { defineTool } from './define';
import { testPorts } from './testing';
import { buildFormModel } from '../form/model';
import { createFormSession } from '../form/session';
import { sessionOptions } from '../form/form.testing';
import { axeViolations } from '../testing/axe';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}

const ports = testPorts({ hash: webCryptoHash });
const model = buildFormModel({
  form: { foto: { tool: 'photo' } },
  properties: { foto: { type: 'file', label: 'Photo' } as unknown as Property },
});
const field = must(model.fields[0]);
const SHA = 'b'.repeat(64);

const fake = (destroy = vi.fn()): FieldTool =>
  defineTool({
    contributes: ['form-field'],
    key: 'photo',
    produces: 'file',
    mount(el, ctx) {
      const b = document.createElement('button');
      b.textContent = 'Take';
      b.onclick = () => ctx.produce([{ sha256: SHA, name: 'p.jpg', mime: 'image/jpeg' }]);
      const c = document.createElement('button');
      c.textContent = 'Remove';
      c.onclick = () => ctx.clear();
      el.append(b, c);
      return { destroy };
    },
  });

describe('ToolMount', () => {
  it('mounts the field tool, forwards produce to the slot and destroys on unmount', async () => {
    const destroy = vi.fn();
    const set = vi.fn();
    const host = createToolHost({ loaders: { photo: async () => fake(destroy) }, ports });
    const view = render(ToolMount, { host, slot: { field, value: undefined, set, id: field.id } });
    (await screen.findByRole('button', { name: 'Take' })).click();
    expect(set).toHaveBeenCalledWith([{ sha256: SHA, name: 'p.jpg', mime: 'image/jpeg' }]);
    expect(await axeViolations(view.container)).toEqual([]);
    view.unmount();
    expect(destroy).toHaveBeenCalled();
  });

  it('the tool sees a value the form changed after mounting (ctx.value is live)', async () => {
    let seen: unknown;
    const reads = defineTool({
      contributes: ['form-field'],
      key: 'photo',
      produces: 'file',
      mount(el, ctx) {
        const b = document.createElement('button');
        b.textContent = 'Read';
        b.onclick = () => (seen = ctx.value);
        el.append(b);
        return { destroy() {} };
      },
    });
    const host = createToolHost({ loaders: { photo: async () => reads }, ports });
    const slot = { field, value: undefined as JsonValue | undefined, set: vi.fn(), id: field.id };
    const view = render(ToolMount, { host, slot });
    const button = await screen.findByRole('button', { name: 'Read' });
    const next = [{ sha256: SHA, name: 'p.jpg', mime: 'image/jpeg' }];
    await view.rerender({ host, slot: { ...slot, value: next } });
    button.click();
    expect(seen).toEqual(next);
  });

  it('ctx.clear() reaches the slot as set(null)', async () => {
    const set = vi.fn();
    const host = createToolHost({ loaders: { photo: async () => fake() }, ports });
    render(ToolMount, { host, slot: { field, value: undefined, set, id: field.id } });
    (await screen.findByRole('button', { name: 'Remove' })).click();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(null);
  });

  it('a required tool field the tool cleared fails form validation; a produced value passes', async () => {
    const input = {
      form: { foto: { tool: 'photo', required: true } },
      properties: { foto: { type: 'file', label: 'Photo' } as unknown as Property },
    };
    const session = createFormSession(buildFormModel(input), sessionOptions(input, {}));
    const host = createToolHost({ loaders: { photo: async () => fake() }, ports });
    render(ToolMount, {
      host,
      slot: { field, value: undefined, set: (v) => session.set('foto', v), id: field.id },
    });
    (await screen.findByRole('button', { name: 'Take' })).click();
    expect(session.validateAll()).toEqual([]);
    screen.getByRole('button', { name: 'Remove' }).click();
    expect(session.validateAll().map((i) => [i.fieldKey, i.kind])).toEqual([['foto', 'required']]);
  });

  it('hands the tool the current list, max_files and accept of the property, and refuses a single object', async () => {
    const input = {
      form: { foto: { tool: 'photo' } },
      properties: {
        foto: {
          type: 'file',
          label: 'Photo',
          max_files: 3,
          accept: ['image/*', '.pdf'],
        } as unknown as Property,
      },
    };
    const f = must(buildFormModel(input).fields[0]);
    const seen: { maxFiles?: number; accept?: readonly string[]; value?: unknown; single?: string }[] = [];
    const tool = defineTool({
      contributes: ['form-field'],
      key: 'photo',
      produces: 'file',
      mount(_el, ctx) {
        const entry: (typeof seen)[number] = { value: ctx.value };
        if (ctx.field.maxFiles !== undefined) entry.maxFiles = ctx.field.maxFiles;
        if (ctx.field.accept !== undefined) entry.accept = ctx.field.accept;
        try {
          ctx.produce({ sha256: SHA, name: 'p.jpg', mime: 'image/jpeg' } as never);
        } catch (e) {
          entry.single = (e as { code?: string }).code ?? 'threw';
        }
        seen.push(entry);
        return { destroy() {} };
      },
    });
    const host = createToolHost({ loaders: { photo: async () => tool }, ports });
    const list = [{ sha256: SHA, name: 'a.jpg', mime: 'image/jpeg' }];
    render(ToolMount, { host, slot: { field: f, value: list, set: vi.fn(), id: f.id } });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      maxFiles: 3,
      accept: ['image/*', '.pdf'],
      value: list,
      single: 'invalid_value',
    });
  });

  it('an unknown tool shows a message instead of a blank', async () => {
    const host = createToolHost({ loaders: {}, ports });
    render(ToolMount, { host, slot: { field, value: undefined, set: vi.fn(), id: field.id } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not be loaded/));
  });
});
