// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { ICON_BADGES, ICON_TEMPLATES, checkLook, droppedFor, templateIcon } from '@ueberblick/builder';
import IconsDialog from '../../../../../../../lib/admin/icons/IconsDialog.svelte';
import type { IconsApi } from '../../../../../../../lib/admin/icons/api';
import type { IconsKit, IconsState } from '../../../../../../../lib/admin/icons/types';

afterEach(() => cleanup());

const SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f00"/></svg>';
const STATE: IconsState = {
  type: 'baum',
  classify: null,
  marker: { color: '#2f855a', icon: { svg: SVG } },
  selects: [],
  options: [],
  stage: null,
};
const kit: IconsKit = { templates: ICON_TEMPLATES, badges: ICON_BADGES, templateIcon, checkLook, droppedFor };

describe('a custom SVG in the icon designer', () => {
  it('is drawn in the overview and in the editor preview on opening', async () => {
    const user = userEvent.setup();
    render(IconsDialog, {
      open: true,
      locale: 'de',
      name: 'Baum',
      kit,
      icons: STATE,
      api: { call: vi.fn() } as unknown as IconsApi,
      onchanged: vi.fn(),
      onstate: vi.fn(),
    });
    const thumb = screen.getByTestId('icons-marker').querySelector('img') as HTMLImageElement;
    expect(decodeURIComponent(thumb.src)).toContain('<circle');
    await user.click(screen.getByTestId('icons-marker').querySelectorAll('button')[0] as HTMLElement);
    const preview = (await screen.findByTestId('icon-preview')) as HTMLImageElement;
    expect(decodeURIComponent(preview.src)).toContain('<circle');
  });

  it('is drawn in the preview after a paste (click to add)', async () => {
    const user = userEvent.setup();
    render(IconsDialog, {
      open: true,
      locale: 'de',
      name: 'Baum',
      kit,
      icons: { ...STATE, marker: null },
      api: { call: vi.fn() } as unknown as IconsApi,
      onchanged: vi.fn(),
      onstate: vi.fn(),
    });
    await user.click(screen.getByTestId('icons-marker').querySelectorAll('button')[0] as HTMLElement);
    await user.click(screen.getByTestId('tab-custom'));
    await user.click(screen.getByTestId('svg-paste'));
    await user.paste(SVG);
    const preview = (await screen.findByTestId('icon-preview')) as HTMLImageElement;
    expect(decodeURIComponent(preview.src)).toContain('<circle');
  });

  it('shows a template-registered key icon (Baum) as current, with its SVG code editable', async () => {
    const user = userEvent.setup();
    render(IconsDialog, {
      open: true,
      locale: 'de',
      name: 'Baum',
      kit,
      icons: { ...STATE, marker: { color: '#2f855a', icon: { key: 'tree-deciduous' } } },
      api: { call: vi.fn() } as unknown as IconsApi,
      onchanged: vi.fn(),
      onstate: vi.fn(),
    });
    await user.click(screen.getByTestId('icons-marker').querySelectorAll('button')[0] as HTMLElement);
    const code = (await screen.findByTestId('svg-paste')) as HTMLTextAreaElement;
    expect(code.value).toContain('<svg');
    expect(code.value).toContain('#2f855a');
    const preview = (await screen.findByTestId('icon-preview')) as HTMLImageElement;
    expect(decodeURIComponent(preview.src)).toContain('<svg');
  });
});
