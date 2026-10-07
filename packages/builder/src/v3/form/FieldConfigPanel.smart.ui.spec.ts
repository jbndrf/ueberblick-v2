// @vitest-environment jsdom
// WP-393: v3's Smart Dropdown in the field config panel: the palette tile, Quellfeld, the checklist per source value,
// the read-only "Regel", and the explanation text of an option in the option rows.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { TASK, clean, openEditor, reloaded, stubBrowser } from './editor.testing';
import { parseChoiceFilter } from './choice';

beforeAll(stubBrowser);
// A closing dialog leaves `pointer-events: none` on the body for a moment; jsdom has no animation to wait for.
const user = userEvent.setup({ pointerEventsCheck: 0 });
afterEach(cleanup);

/** A fresh Smart Dropdown selected in the form; its key is `neues_feld`. */
async function smartField() {
  const h = await openEditor();
  await user.click(screen.getByTestId('tile-smart_dropdown'));
  await h.select('neues_feld');
  return h;
}
const filterOf = (h: Awaited<ReturnType<typeof openEditor>>) => h.entry('neues_feld')?.choice_filter;

describe('the Smart Dropdown tile', () => {
  it('places a select with an open filter and shows its section', async () => {
    const h = await smartField();
    expect(h.prop('neues_feld')?.type).toBe('select');
    expect(filterOf(h)).toBe('true');
    const smart = screen.getByTestId('cfg-smart');
    expect(within(smart).getByText('Quellfeld')).toBeTruthy();
    expect(within(smart).getByTestId('smart-browse')).toBeTruthy();
    expect(screen.queryByTestId('smart-configure')).toBeNull();
  });

  it('a plain select shows no Smart section', async () => {
    const h = await openEditor();
    await h.select('vitalitaet');
    expect(screen.queryByTestId('cfg-smart')).toBeNull();
  });
});

describe('Quellfeld and the checklist write a choice_filter that compiles and round-trips', () => {
  it('picks the source from the earlier selects, grouped by page, and clears it again', async () => {
    const h = await smartField();
    await user.click(screen.getByTestId('smart-browse'));
    const picker = screen.getByTestId('smart-picker');
    expect(within(picker).getByText('Seite 1')).toBeTruthy();
    expect(within(picker).getByTestId('smart-source-vitalitaet').textContent).toContain('Vitalität');
    expect(within(picker).queryByTestId('smart-source-neues_feld')).toBeNull();
    await user.click(within(picker).getByTestId('smart-source-vitalitaet'));
    expect(filterOf(h)).toBe("form.vitalitaet == 'v0' ? option in [] : false");
    expect(within(screen.getByTestId('smart-source')).getByText(/Vitalität/)).toBeTruthy();
    await user.click(screen.getByTestId('smart-clear'));
    expect(filterOf(h)).toBe('true');
  });

  it('the dialog has a tab per source value; ticking writes the branch; a new option is offered at once', async () => {
    const h = await smartField();
    await user.click(screen.getByTestId('smart-browse'));
    await user.click(screen.getByTestId('smart-source-vitalitaet'));
    await waitFor(() => expect(screen.queryByTestId('smart-picker')).toBeNull());
    await user.click(screen.getByTestId('smart-configure'));
    const modal = screen.getByTestId('smart-modal');
    expect(within(modal).getByTestId('smart-tab-v0')).toBeTruthy();
    expect(within(modal).getByTestId('smart-tab-v4')).toBeTruthy();
    expect(
      within(modal).getByText('Dieses Feld hat noch keine Optionen. Füge unten eine hinzu.'),
    ).toBeTruthy();

    await user.type(within(modal).getByTestId('smart-option-new'), 'Eiche{Enter}');
    await user.type(within(modal).getByTestId('smart-option-new'), 'Buche{Enter}');
    expect(Object.keys(h.prop('neues_feld')?.options ?? {})).toEqual(['eiche', 'buche']);
    expect(filterOf(h)).toBe("form.vitalitaet == 'v0' ? option in ['eiche', 'buche'] : false");
    expect(within(modal).getByTestId('smart-dot-v0')).toBeTruthy();

    await user.click(within(modal).getByTestId('smart-tab-v1'));
    expect(within(modal).getByTestId('smart-panel').getAttribute('data-when')).toBe('v1');
    await user.click(within(modal).getByTestId('smart-option-buche'));
    expect(filterOf(h)).toBe(
      "form.vitalitaet == 'v0' ? option in ['eiche', 'buche'] : form.vitalitaet == 'v1' ? option in ['buche'] : false",
    );
    await user.click(within(modal).getByTestId('smart-option-buche'));
    // an emptied branch stays: it offers nothing, and the file says so
    expect(filterOf(h)).toBe(
      "form.vitalitaet == 'v0' ? option in ['eiche', 'buche'] : form.vitalitaet == 'v1' ? option in [] : false",
    );

    await user.click(within(modal).getByTestId('smart-done'));
    await waitFor(() => expect(screen.queryByTestId('smart-modal')).toBeNull());
    expect(screen.getByTestId('smart-count').textContent?.trim()).toBe('1');

    // read back after a reload, and the draft has no new problem at the form
    const again = reloaded(h.last());
    const src = again.effective().tasks?.[TASK]?.form?.['neues_feld']?.choice_filter;
    expect(parseChoiceFilter(src).kind).toBe('smart');
    const before = new Set(
      clean()
        .problems()
        .map((p) => `${p.code} ${p.path}`),
    );
    expect(again.problems().filter((p) => !before.has(`${p.code} ${p.path}`))).toEqual([]);
  });
});

describe('a hand-written filter', () => {
  it('shows read-only as a Regel row and stays as it is', async () => {
    const hand = "option != 'v4'";
    const doc = clean().apply({
      kind: 'set',
      path: `tasks.${TASK}.form.vitalitaet.choice_filter`,
      value: hand,
    }).doc;
    const h = await openEditor(doc);
    await h.select('vitalitaet');
    expect(screen.getByTestId('smart-foreign').textContent).toBe(hand);
    expect(screen.queryByTestId('smart-browse')).toBeNull();
    expect(h.entry('vitalitaet')?.choice_filter).toBe(hand);
  });
});

describe('the explanation text of an option', () => {
  it('is edited in the option row of the Felddefinition and shows under the option in the dialog', async () => {
    const h = await smartField();
    await user.click(screen.getByTestId('cfg-edit-definition'));
    const options = screen.getByTestId('field-options');
    await user.type(within(options).getByTestId('field-option-new'), 'Eiche{Enter}');
    const hint = within(options).getByTestId('option-hint-eiche');
    await user.type(hint, 'Quercus robur');
    await user.tab();
    expect(h.prop('neues_feld')?.option_hints).toEqual({ eiche: { de: 'Quercus robur' } });
    await user.clear(hint);
    await user.tab();
    expect(h.prop('neues_feld')?.option_hints).toEqual({});
    await user.type(hint, 'Quercus robur');
    await user.tab();
    // removing the option takes its explanation with it (a hint of no option is a schema error)
    await user.click(within(options).getByRole('button', { name: /Eiche.*entfernen|entfernen.*Eiche/i }));
    expect(h.prop('neues_feld')?.option_hints).toEqual({});
    expect(Object.keys(h.prop('neues_feld')?.options ?? {})).toEqual([]);
  });
});
