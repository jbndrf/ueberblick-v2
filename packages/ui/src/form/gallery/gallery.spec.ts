// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from '../FormRenderer.svelte';
import { buildFormModel } from '../model';
import { createFormSession } from '../session';
import { sessionOptions } from '../form.testing';
import '../../components/ui/jsdom-shims.testing';
import { axeViolations } from '../../testing/axe';
import { PHOTO_URL_KEY } from './context';
import { fileRefs, type GalleryFile, type PhotoUrl } from './files';
import MediaGallery from './MediaGallery.svelte';

const sha = (c: string) => c.repeat(64);
const photo = (c: string, name = `${c}.jpg`): GalleryFile => ({ sha256: sha(c), name, mime: 'image/jpeg' });
const pdf: GalleryFile = { sha256: sha('d'), name: 'plan.pdf', mime: 'application/pdf' };

const urls = () =>
  Object.assign(
    vi.fn<(s: string, size: string) => string>((s, size) => `/thumb/${s.slice(0, 2)}?${size}`),
    { original: (s: string) => `/full/${s.slice(0, 2)}` },
  ) as PhotoUrl & ReturnType<typeof vi.fn>;
const withUrls = (resolve: PhotoUrl) => new Map([[PHOTO_URL_KEY, resolve]]);
/** `render` with props and the resolver in context. */
const show = (component: unknown, props: Record<string, unknown>, resolve?: PhotoUrl) =>
  render(component as never, { props, ...(resolve ? { context: withUrls(resolve) } : {}) } as never);

describe('fileRefs', () => {
  it('reads a list of file entries and drops anything else', () => {
    expect(fileRefs([photo('a'), { sha256: 'short' }, 'x', null, { name: 'n' }])).toEqual([photo('a')]);
    expect(fileRefs(undefined)).toEqual([]);
  });
  it('never throws and never invents an entry for any JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        for (const f of fileRefs(v as never)) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });
});

describe('MediaGallery', () => {
  // bits-ui locks the body while a dialog is open; a test that ends with one open must not leak that.
  beforeEach(() => {
    document.body.style.pointerEvents = '';
  });

  it('shows every file: images from the resolver, other files as a named row', async () => {
    const resolve = urls();
    show(MediaGallery, { files: [photo('a'), photo('b'), pdf], mode: 'view' }, resolve);
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(2));
    expect([...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      '/thumb/aa?preview',
      '/thumb/bb?preview',
    ]);
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });

  it('asks the resolver for the small size in Daten', async () => {
    const resolve = urls();
    show(MediaGallery, { files: [photo('a')], mode: 'view', size: 'list' }, resolve);
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(sha('a'), 'list'));
  });

  it('falls back to the original when a thumbnail does not load, then to the placeholder (WP-708)', async () => {
    const resolve = urls();
    show(MediaGallery, { files: [photo('a')], mode: 'view', size: 'list' }, resolve);
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('/thumb/aa?list'));
    fireEvent.error(document.querySelector('img') as Element);
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('/full/aa'));
    fireEvent.error(document.querySelector('img') as Element);
    await waitFor(() => expect(document.querySelector('img')).toBeNull());
    expect(screen.getByRole('img', { name: 'a.jpg' }).tagName).toBe('SPAN');
  });

  it('without a resolver every file is a file row, never a broken image', () => {
    show(MediaGallery, { files: [photo('a')], mode: 'view' });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('a.jpg')).toBeTruthy();
  });

  it('remove drops exactly that entry, only in fill mode', async () => {
    const onRemove = vi.fn();
    const view = show(MediaGallery, { files: [photo('a'), photo('b')], mode: 'fill', onRemove }, urls());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove b.jpg' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(1);
    view.unmount();
    show(MediaGallery, { files: [photo('a')], mode: 'view', onRemove }, urls());
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  describe('kit carousel (v3 Embla)', () => {
    const files = [photo('a'), photo('b'), photo('c'), photo('d')];
    it('is a carousel region of aspect-[2/3] slides, three visible in a full column', async () => {
      show(MediaGallery, { files, mode: 'view' }, urls());
      expect(screen.getByRole('region').getAttribute('aria-roledescription')).toBe('carousel');
      const slides = document.querySelectorAll('[data-slot="carousel-item"]');
      expect(slides).toHaveLength(4);
      expect(slides[0]?.className).toContain('basis-1/3');
      expect(slides[0]?.querySelector('.aspect-\\[2\\/3\\]')).not.toBeNull();
      await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(4));
    });
    it('half column shows 1.5 (basis-2/3), narrow columns one (basis-full)', () => {
      const half = show(MediaGallery, { files, mode: 'view', columnPosition: 'half' }, urls());
      expect(document.querySelector('[data-slot="carousel-item"]')?.className).toContain('basis-2/3');
      half.unmount();
      show(MediaGallery, { files, mode: 'view', columnPosition: 'third' }, urls());
      expect(document.querySelector('[data-slot="carousel-item"]')?.className).toContain('basis-full');
    });
    it('arrows only when there are more items than visible', () => {
      const few = show(MediaGallery, { files: files.slice(0, 3), mode: 'view' }, urls());
      expect(screen.queryByText('Next slide')).toBeNull();
      few.unmount();
      show(MediaGallery, { files, mode: 'view' }, urls());
      expect(screen.getByText('Next slide')).toBeTruthy();
      expect(screen.getByText('Previous slide')).toBeTruthy();
    });
  });

  describe('lightbox', () => {
    const open = async () => {
      show(MediaGallery, { files: [photo('a'), pdf, photo('b'), photo('c')], mode: 'view' }, urls());
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Open b.jpg' }));
      return { user, dialog: await screen.findByRole('dialog') };
    };
    const shown = (dialog: HTMLElement) => within(dialog).getByRole('img').getAttribute('alt');

    it('opens at the tapped image and counts over images only', async () => {
      const { dialog } = await open();
      expect(shown(dialog)).toBe('b.jpg');
      expect(within(dialog).getByText('2 / 3')).toBeTruthy();
    });

    it('previous and next buttons, disabled at the ends', async () => {
      const { user, dialog } = await open();
      await user.click(within(dialog).getByRole('button', { name: 'Next photo' }));
      expect(shown(dialog)).toBe('c.jpg');
      expect((within(dialog).getByRole('button', { name: 'Next photo' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      await user.click(within(dialog).getByRole('button', { name: 'Previous photo' }));
      await user.click(within(dialog).getByRole('button', { name: 'Previous photo' }));
      expect(shown(dialog)).toBe('a.jpg');
      expect(
        (within(dialog).getByRole('button', { name: 'Previous photo' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('arrow keys move, Escape closes', async () => {
      const { user, dialog } = await open();
      await user.keyboard('{ArrowRight}');
      expect(shown(dialog)).toBe('c.jpg');
      await user.keyboard('{ArrowRight}');
      expect(shown(dialog)).toBe('c.jpg');
      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(shown(dialog)).toBe('a.jpg');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('passes axe', async () => {
      const { dialog } = await open();
      expect(await axeViolations(dialog)).toEqual([]);
    });
  });

  it('the gallery strip passes axe', async () => {
    const { container } = show(
      MediaGallery,
      { files: [photo('a'), pdf], mode: 'fill', onRemove: vi.fn() },
      urls(),
    );
    await waitFor(() => expect(document.querySelector('img')).not.toBeNull());
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the file field of a form', () => {
  const P = (type: string, extra: Record<string, unknown> = {}) =>
    ({ type, ...extra }) as unknown as Property;
  it('shows the stored files and removes one entry from the value', async () => {
    const props = { f: P('file', { label: 'Photo', max_files: 3 }) };
    const input = { form: { f: {} }, properties: props };
    const session = createFormSession(
      buildFormModel(input),
      sessionOptions(input, undefined, { initial: { f: [photo('a'), photo('b')] } }),
    );
    show(FormRenderer, { session, onsubmit: vi.fn() }, urls());
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove a.jpg' }));
    expect(session.get('f')).toEqual([photo('b')]);
    expect(screen.queryByRole('button', { name: 'Remove a.jpg' })).toBeNull();
  });
});
