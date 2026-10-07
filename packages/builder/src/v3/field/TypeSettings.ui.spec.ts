// @vitest-environment jsdom
// WP-381: the definition block of v3's FieldConfigPanel inside WP-337's pane: the limits of a number, the date mode,
// the file types and the maximum files, and Berechnet (Erweitert). One test per element; a valid expression saves,
// an invalid one shows the problem and is not written.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerFieldPane } from './register';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
});
afterEach(cleanup);

const withDoubled = (): Doc =>
  openProject(musterstadt.templateSrc, musterstadt.overlaySrc).apply({
    kind: 'add',
    path: 'types.baum.properties.hoehe_x2',
    value: { type: 'number', label: { de: 'Doppelte Höhe' } },
  }).doc;

async function openField(key: string, doc: Doc = withDoubled()) {
  const registry = createBuilderRegistry();
  registerFieldPane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  await userEvent.click(document.querySelector(`[data-path="types.baum.properties.${key}"]`) as HTMLElement);
  const last = (): Doc => (onchange.mock.calls.at(-1)?.[0] as Doc) ?? doc;
  const prop = () => last().effective().types?.['baum']?.properties[key];
  return { last, prop, pane: () => within(screen.getByTestId('field-pane')) };
}

const typeInto = async (el: HTMLElement, text: string): Promise<void> => {
  await userEvent.clear(el);
  if (text !== '') await userEvent.type(el, text);
  await userEvent.tab();
};

describe('number limits', () => {
  it('min and max are written on the property, and an empty input removes the limit', async () => {
    const h = await openField('hoehe_m');
    expect((h.pane().getByTestId('field-min') as HTMLInputElement).value).toBe('0');
    await typeInto(h.pane().getByTestId('field-max'), '80');
    expect(h.prop()).toMatchObject({ min: 0, max: 80 });
    await typeInto(h.pane().getByTestId('field-min'), '');
    expect(h.prop()?.min).toBeUndefined();
  });

  it('a text has no number limits', async () => {
    const h = await openField('befund');
    expect(h.pane().queryByTestId('type-number')).toBeNull();
  });
});

describe('date mode', () => {
  it('the three modes are the property types date, datetime and time', async () => {
    const h = await openField('faellig_am');
    expect(h.pane().getByTestId('date-mode-date').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(h.pane().getByTestId('date-mode-datetime'));
    expect(h.prop()?.type).toBe('datetime');
    await userEvent.click(h.pane().getByTestId('date-mode-time'));
    expect(h.prop()?.type).toBe('time');
  });
});

describe('files', () => {
  it('the allowed file types are a preset and the maximum files a number (Q7)', async () => {
    const h = await openField('foto');
    expect((h.pane().getByTestId('field-file-types') as HTMLSelectElement).value).toBe('images');
    await userEvent.selectOptions(h.pane().getByTestId('field-file-types'), 'documents');
    expect(h.prop()?.accept).toEqual(['.pdf', '.doc', '.docx', '.txt']);
    await userEvent.selectOptions(h.pane().getByTestId('field-file-types'), 'all');
    expect(h.prop()?.accept).toBeUndefined();
    await typeInto(h.pane().getByTestId('field-max-files'), '3');
    expect(h.prop()?.max_files).toBe(3);
  });
});

describe('Berechnet', () => {
  it('a valid expression saves; the fields it reads are listed, an unknown one in red', async () => {
    const h = await openField('hoehe_x2');
    await userEvent.click(h.pane().getByTestId('field-computed'));
    await userEvent.type(h.pane().getByTestId('field-computed-expression'), 'self.hoehe_m * 2');
    expect(within(h.pane().getByTestId('field-computed-deps')).getByText('Höhe (m)')).toBeTruthy();
    await userEvent.click(h.pane().getByTestId('field-computed-apply'));
    expect(h.prop()?.computed).toBe('self.hoehe_m * 2');
    expect(h.pane().queryByTestId('field-computed-error')).toBeNull();
    expect(
      h
        .last()
        .problems()
        .filter((p) => p.path.startsWith('types.baum.properties.hoehe_x2')),
    ).toEqual([]);
  });

  it('an invalid expression shows the problem and is not written', async () => {
    const h = await openField('hoehe_x2');
    await userEvent.click(h.pane().getByTestId('field-computed'));
    await userEvent.type(h.pane().getByTestId('field-computed-expression'), 'self.gibt_es_nicht * 2');
    expect(within(h.pane().getByTestId('field-computed-deps')).getByText('Unbekanntes Feld')).toBeTruthy();
    await userEvent.click(h.pane().getByTestId('field-computed-apply'));
    expect(h.pane().getByTestId('field-computed-error').textContent?.length ?? 0).toBeGreaterThan(0);
    expect(h.prop()?.computed).toBeUndefined();
  });

  it('a field that is in a form cannot become computed (the engine refuses it there)', async () => {
    const h = await openField('hoehe_m');
    await userEvent.click(h.pane().getByTestId('field-computed'));
    expect(h.pane().getByTestId('field-computed-error').textContent).toContain('in keinem Formular');
    expect(h.pane().queryByTestId('field-computed-expression')).toBeNull();
  });

  it('turning Berechnet off removes the expression', async () => {
    const h = await openField('hoehe_x2');
    await userEvent.click(h.pane().getByTestId('field-computed'));
    await userEvent.type(h.pane().getByTestId('field-computed-expression'), 'self.hoehe_m * 2');
    await userEvent.click(h.pane().getByTestId('field-computed-apply'));
    await userEvent.click(h.pane().getByTestId('field-computed'));
    expect(h.prop()?.computed).toBeUndefined();
  });
});
