// The axe cases of the form components, for the coverage guard in `components.a11y.spec.ts`. Test-only.
import { render } from '@testing-library/svelte';
import type { Property } from '@ueberblick/core/model';
import '../components/ui/jsdom-shims.testing';
import ClearingDialog from './ClearingDialog.svelte';
import FormRenderer from './FormRenderer.svelte';
import GalleryImage from './gallery/GalleryImage.svelte';
import Lightbox from './gallery/Lightbox.svelte';
import MediaGallery from './gallery/MediaGallery.svelte';
import PageTabs from './PageTabs.svelte';
import { sessionOptions } from './form.testing';
import { buildFormModel } from './model';
import { createFormSession } from './session';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
type Case = readonly [state: string, run: () => Promise<Element>];

const GALLERY_FILES = [
  { sha256: 'a'.repeat(64), name: 'tree.jpg', mime: 'image/jpeg' },
  { sha256: 'b'.repeat(64), name: 'plan.pdf', mime: 'application/pdf' },
  { sha256: 'c'.repeat(64), name: 'leaf.jpg', mime: 'image/jpeg' },
];

const formInput = {
  form: { a: { required: true }, s: {}, b: {}, d: {}, ms: {}, n: {}, t: { appearance: 'multiline' } },
  properties: {
    a: P('text', { label: 'First', description: 'Help' }),
    s: P('select', { label: 'Pick', options: { x: 'X', y: 'Y' } }),
    b: P('boolean', { label: 'Flag' }),
    d: P('date', { label: 'Day' }),
    ms: P('multiselect', { label: 'Many', options: { x: 'X', y: 'Y' } }),
    n: P('number', { label: 'Number' }),
    t: P('text', { label: 'Note' }),
  },
};
const session = () => createFormSession(buildFormModel(formInput), sessionOptions(formInput));
const tick = () => new Promise((r) => setTimeout(r, 0));
const renderer = async (): Promise<Element> =>
  render(FormRenderer, { session: session(), onsubmit: () => {} }).container;

export const FORM_A11Y_CASES: Record<string, readonly Case[]> = {
  'form/gallery/GalleryImage.svelte': [
    [
      'image',
      async () =>
        render(GalleryImage, {
          sha256: 'a'.repeat(64),
          size: 'list',
          alt: 'tree.jpg',
          resolve: Object.assign(() => '/t.jpg', { original: () => '/t.jpg' }),
        }).container,
    ],
  ],
  'form/gallery/Lightbox.svelte': [
    [
      'open',
      async () =>
        render(Lightbox, {
          images: GALLERY_FILES,
          index: 0,
          open: true,
          resolve: Object.assign(() => '/t.jpg', { original: () => '/t.jpg' }),
        }).baseElement,
    ],
  ],
  'form/gallery/MediaGallery.svelte': [
    [
      'fill',
      async () =>
        render(MediaGallery, { files: GALLERY_FILES, mode: 'fill', onRemove: () => {} }, {}).container,
    ],
  ],
  'form/ClearingDialog.svelte': [
    [
      'listing two fields',
      async () =>
        render(ClearingDialog, {
          fields: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' },
          ],
          onconfirm: () => {},
          oncancel: () => {},
        }).baseElement,
    ],
  ],
  'form/FieldChrome.svelte': [['label, star and help, via the form renderer', renderer]],
  'form/FieldInput.svelte': [['every input type, via the form renderer', renderer]],
  'form/PageTabs.svelte': [
    [
      'with a missing count',
      async () =>
        render(PageTabs, {
          pages: [
            { title: 'Page 1', missing: 2 },
            { title: 'Page 2', missing: 0 },
          ],
          current: 0,
          onselect: () => {},
        }).container,
    ],
  ],
  'form/FormRenderer.svelte': [
    [
      'submitted with a required field empty',
      async () => {
        const v = render(FormRenderer, { session: session(), onsubmit: () => {} });
        (v.container.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.click();
        await tick();
        return v.container;
      },
    ],
  ],
};
