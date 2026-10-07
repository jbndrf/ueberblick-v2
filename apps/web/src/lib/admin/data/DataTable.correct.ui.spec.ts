// @vitest-environment jsdom
// WP-370 (owner answer A1): Bearbeitungsmodus on the data page. Edits of a row are collected; the row's check sends
// ONE Admin-Korrektur; a refusal marks the cell; the stage is read-only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import DataTable from './DataTable.svelte';

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-scroll') ? 600 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-scroll') ? 1000 : 0;
  },
});

const type = {
  label: { de: 'Baum' },
  process: { property: 'stage', start: 'erfasst', end: ['gefaellt'] },
  properties: {
    stage: { type: 'select', options: { erfasst: { de: 'Erfasst' }, gefaellt: { de: 'Gefällt' } } },
    befund: { type: 'text', label: { de: 'Befund' } },
    hoehe_m: { type: 'number', label: { de: 'Höhe (m)' } },
    notiz: { type: 'text', label: { de: 'Notiz' } },
  },
} as never;

const row = (over: Record<string, unknown> = {}) => ({
  $id: 'f1',
  $lifecycle: 'active',
  $created_by: 'u1',
  $created_at: '2026-03-04T10:00:00.000Z',
  $changed_at: '2026-03-04T10:00:00.000Z',
  $seq: 4,
  stage: 'erfasst',
  befund: 'Pilz 1',
  hoehe_m: 12.5,
  notiz: 'alt',
  ...over,
});

interface Sent {
  url: URL;
  method: string;
  body?: unknown;
}
const sent: Sent[] = [];
let postStatus = 200;
let postBody: unknown = { runId: 'r1', seq: 5 };
let current = row();

beforeEach(() => {
  sessionStorage.clear();
  sent.length = 0;
  postStatus = 200;
  postBody = { runId: 'r1', seq: 5 };
  current = row();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://x');
      const method = init?.method ?? 'GET';
      sent.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (method === 'POST')
        return { ok: postStatus < 300, status: postStatus, json: async () => postBody } as Response;
      if (url.pathname.endsWith('/distinct'))
        return { ok: true, status: 200, json: async () => [] } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ rows: [current], next: null, total: 1 }),
      } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const props = {
  locale: 'de' as const,
  project: 'musterstadt',
  typeKey: 'baum',
  type,
  names: { u1: 'Anna Beispiel' },
};
const rowEl = () =>
  screen.getAllByRole('row').find((r) => r.getAttribute('data-row-id') === 'f1') as HTMLElement;
const posts = () => sent.filter((s) => s.method === 'POST');

async function editText(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.click(within(rowEl()).getByRole('button', { name: from }));
  const box = screen.getByRole(/^\d/.test(to) ? 'spinbutton' : 'textbox');
  await user.clear(box);
  await user.type(box, `${to}{Enter}`);
}

describe('Bearbeitungsmodus on the data page', () => {
  it('three edits in one row and the check make exactly one Admin-Korrektur, then the row is read again', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.click(screen.getByRole('switch', { name: 'Bearbeitungsmodus' }));
    await editText(user, 'Pilz 1', 'Kronenpilz');
    await editText(user, '12.5', '14');
    await editText(user, 'alt', 'neu');
    expect(posts()).toHaveLength(0);
    current = row({ befund: 'Kronenpilz', hoehe_m: 14, notiz: 'neu', $seq: 5 });
    await user.click(within(rowEl()).getByRole('button', { name: 'Änderungen dieser Zeile speichern' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const post = posts()[0] as Sent;
    expect(post.url.pathname).toBe('/api/admin/p/musterstadt/features/f1/correct');
    expect(post.body).toEqual({
      values: { befund: 'Kronenpilz', hoehe_m: 14, notiz: 'neu' },
      expected_seq: 4,
    });
    await waitFor(() => expect(sent.some((s) => s.url.searchParams.get('filter.$id') === 'f1')).toBe(true));
    expect(await within(rowEl()).findByText('Kronenpilz')).toBeTruthy();
    expect(within(rowEl()).queryByRole('button', { name: 'Änderungen dieser Zeile speichern' })).toBeNull();
  });

  it('Cancel discards the edits and sends nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.click(screen.getByRole('switch', { name: 'Bearbeitungsmodus' }));
    await editText(user, 'Pilz 1', 'Anders');
    await user.click(within(rowEl()).getByRole('button', { name: 'Änderungen dieser Zeile verwerfen' }));
    expect(within(rowEl()).getByText('Pilz 1')).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it('a refusal marks the offending cell with the reason, and the other edits stay', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.click(screen.getByRole('switch', { name: 'Bearbeitungsmodus' }));
    await editText(user, 'Pilz 1', 'Kronenpilz');
    await editText(user, '12.5', '99');
    postStatus = 422;
    postBody = {
      error: {
        code: 'run_refused',
        message: 'zu hoch',
        issues: [{ path: 'input.values.hoehe_m', message: 'zu hoch' }],
      },
    };
    await user.click(within(rowEl()).getByRole('button', { name: 'Änderungen dieser Zeile speichern' }));
    const bad = await waitFor(() => {
      const el = rowEl().querySelector('[aria-invalid="true"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(bad.getAttribute('title')).toBe('zu hoch');
    expect(within(bad).getByText('99')).toBeTruthy();
    expect(within(rowEl()).getByText('Kronenpilz')).toBeTruthy();
  });

  it('the stage is read-only in Bearbeitungsmodus, with a tooltip', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(DataTable, props);
    await screen.findByText('Pilz 1');
    await user.click(screen.getByRole('switch', { name: 'Bearbeitungsmodus' }));
    const stage = within(rowEl()).getByTestId('stage-cell');
    expect(stage.textContent?.trim()).toBe('Erfasst');
    expect(stage.getAttribute('title')).toBe('Die Stufe ändert sich über Aufgaben.');
    await user.click(stage);
    expect(within(rowEl()).queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
