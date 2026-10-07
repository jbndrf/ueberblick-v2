// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import ProjectFileSection from './ProjectFileSection.svelte';
import type { SectionProps } from './sections';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FILE = 'schema: ueberblick/1\nextends: baumkataster@1\n';
const reload = vi.fn(() => Promise.resolve());
const props = { locale: 'de', project: 'p', reload } as unknown as SectionProps;

function stub(apply: () => Response): ReturnType<typeof vi.fn> {
  const f = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(init?.method === 'POST' ? apply() : Response.json({ text: FILE, revision: 4 })),
  );
  vi.stubGlobal('fetch', f);
  return f;
}

describe('Projektdatei section', () => {
  it('shows the draft file, applies a valid edit', async () => {
    const f = stub(() => Response.json({ revision: 5 }));
    render(ProjectFileSection, props);
    const box = (await screen.findByTestId('project-file-text')) as HTMLTextAreaElement;
    expect(box.value).toBe(FILE);
    await userEvent.type(box, '# edit');
    await userEvent.click(screen.getByTestId('project-file-apply'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    const post = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      text: FILE + '# edit',
      revision: 4,
    });
  });

  it('lists the problems with their paths and keeps the text when the file is refused', async () => {
    stub(() =>
      Response.json(
        { ok: false, code: 'invalid', problems: [{ path: 'types.baum', message: 'Unbekannt' }] },
        { status: 400 },
      ),
    );
    reload.mockClear();
    render(ProjectFileSection, props);
    const box = (await screen.findByTestId('project-file-text')) as HTMLTextAreaElement;
    await userEvent.type(box, 'x');
    await userEvent.click(screen.getByTestId('project-file-apply'));
    const list = await screen.findByTestId('project-file-problems');
    expect(list.textContent).toContain('types.baum');
    expect(list.textContent).toContain('Unbekannt');
    expect(box.value).toBe(FILE + 'x');
    expect(reload).not.toHaveBeenCalled();
  });
});
