// @vitest-environment jsdom
// WP-393: v3's entity selector in the field config panel: the source (Tabelle, Teilnehmende) is the property type,
// "Nur Selbstauswahl" and "Kann jeden auswählen" are the constraint, "Rollen mit Sichtbarkeit" the `see` roles.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { TASK, openEditor, reloaded, stubBrowser } from './editor.testing';
import { propertyAudience } from '../field/perms';

beforeAll(stubBrowser);
afterEach(cleanup);
// A closing dialog leaves `pointer-events: none` on the body for a moment; jsdom has no animation to wait for.
const user = userEvent.setup({ pointerEventsCheck: 0 });

const KEY = 'neues_feld';

/** A fresh entity selector (a reference to the first table) selected in the form. */
async function selectorField() {
  const h = await openEditor();
  await user.click(screen.getByTestId('tile-custom_table_selector'));
  await h.select(KEY);
  return h;
}
const radio = (source: 'table' | 'participants') =>
  within(screen.getByTestId(`entity-source-${source}`)).getByRole('radio');

async function pick(testid: string, name: RegExp): Promise<void> {
  const group = screen.getByTestId(testid);
  await user.click(within(group).getAllByRole('button')[0] as HTMLButtonElement);
  await user.click(screen.getByRole('option', { name }));
}

describe('the entity selector tile and Auswählen aus', () => {
  it('places a reference to the first table, with the Tabelle source on', async () => {
    const h = await selectorField();
    expect(h.prop(KEY)).toMatchObject({ type: 'reference', to: 'baumart' });
    expect(radio('table').getAttribute('aria-checked')).toBe('true');
    expect(radio('participants').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('entity-configured')).toBeTruthy();
  });

  it('Teilnehmende makes a participant property; Tabelle makes a reference again', async () => {
    const h = await selectorField();
    await user.click(radio('participants'));
    expect(h.prop(KEY)?.type).toBe('participant');
    expect(h.prop(KEY)).not.toHaveProperty('to');
    expect(screen.queryByTestId('entity-configured')).toBeNull();
    await user.click(radio('table'));
    expect(h.prop(KEY)).toMatchObject({ type: 'reference', to: 'baumart' });
  });

  it('a plain text field has no selector section', async () => {
    const h = await openEditor();
    await h.select('befund');
    expect(screen.queryByTestId('cfg-entity')).toBeNull();
  });
});

describe('Tabelle: the table and "Rollen mit Sichtbarkeit"', () => {
  it('picks the table; empty roles mean every role, a role writes the see map', async () => {
    const h = await selectorField();
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    expect(within(modal).getByText('Auswahl aus Tabelle konfigurieren')).toBeTruthy();
    expect(within(modal).getByText(/Leer lassen bedeutet: alle Rollen/)).toBeTruthy();
    expect(screen.queryByText(/niemand sieht/i)).toBeNull();

    await user.click(
      within(within(modal).getByTestId('entity-see')).getAllByRole('button')[0] as HTMLButtonElement,
    );
    await user.click(screen.getByRole('option', { name: /Verwaltung/ }));
    expect(propertyAudience(h.last().effective(), 'baum', 'see', KEY)).toEqual({
      kind: 'roles',
      roles: ['verwaltung'],
    });

    // reading it back fills the modal
    cleanup();
    const again = await openEditor(reloaded(h.last()));
    await again.select(KEY);
    await user.click(screen.getByTestId('entity-configure'));
    const seen = within(screen.getByTestId('entity-modal')).getByTestId('entity-see');
    expect(seen.textContent).toContain('Verwaltung');
  });

  it('offers Rollen as the third source (A-051)', async () => {
    await selectorField();
    expect(screen.getByTestId('entity-source-roles')).toBeTruthy();
  });

  it('"Mehrfachauswahl erlauben" writes cardinality many and reads back; off takes it out again', async () => {
    const h = await selectorField();
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    expect(within(modal).getByText('Mehrfachauswahl erlauben')).toBeTruthy();
    const many = within(modal).getByTestId('entity-many');
    expect(many.getAttribute('aria-checked')).toBe('false');
    await user.click(many);
    expect(h.prop(KEY)).toMatchObject({ type: 'reference', cardinality: 'many' });
    await user.click(many);
    expect(h.prop(KEY)).not.toHaveProperty('cardinality');
    await user.click(many);
    cleanup();
    const again = await openEditor(reloaded(h.last()));
    await again.select(KEY);
    await user.click(screen.getByTestId('entity-configure'));
    expect(
      within(screen.getByTestId('entity-modal')).getByTestId('entity-many').getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('"Anzeigefeld" lists the properties of the table with their type; the default is the display name', async () => {
    const h = await selectorField();
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    const display = within(modal).getByTestId('entity-display');
    expect(within(display).getByText('Anzeigefeld')).toBeTruthy();
    expect(display.textContent).toContain('Anzeigename (Standard)');
    await user.click(within(display).getAllByRole('button')[0] as HTMLButtonElement);
    expect(
      screen
        .getAllByRole('option')
        .slice(-3)
        .map((o) => o.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Anzeigename (Standard)', 'Name text', 'Lateinischer Name text']);
    await user.click(screen.getByRole('option', { name: /Lateinischer Name/ }));
    expect(h.prop(KEY)).toMatchObject({ display_property: 'name_lat' });
    await user.click(within(display).getAllByRole('button')[0] as HTMLButtonElement);
    await user.click(screen.getByRole('option', { name: /Anzeigename \(Standard\)/ }));
    expect(h.prop(KEY)).not.toHaveProperty('display_property');
  });

  it('a participant source has Mehrfachauswahl but no Anzeigefeld', async () => {
    const h = await selectorField();
    await user.click(radio('participants'));
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    expect(within(modal).queryByTestId('entity-display')).toBeNull();
    await user.click(within(modal).getByTestId('entity-many'));
    expect(h.prop(KEY)).toMatchObject({ type: 'participant', cardinality: 'many' });
  });
});

describe('Rollen: "Nur Selbstauswahl" and "Kann jeden auswählen" write the property select (WP-481, A-055)', () => {
  it('writes select.all / select.self, says what the other roles may, reads back, and clears when both are empty', async () => {
    const h = await selectorField();
    await user.click(
      screen.getByTestId('entity-source-roles').querySelector('[role="radio"]') as HTMLElement,
    );
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    expect(within(modal).getByTestId('entity-summary').textContent).toBe(
      'Alle Rollen können jeden auswählen.',
    );
    await pick('entity-any', /Verwaltung/);
    expect(h.prop(KEY)).toMatchObject({ type: 'role', select: { all: ['verwaltung'] } });
    expect(h.entry(KEY)?.constraint).toBeUndefined();
    expect(within(modal).getByTestId('entity-summary').textContent).toBe(
      'Alle übrigen Rollen können keine Rolle auswählen.',
    );
    await pick('entity-self', /Bauhof/);
    expect(h.prop(KEY)).toMatchObject({ select: { all: ['verwaltung'], self: ['bauhof'] } });
    expect(screen.getByTestId('entity-configured')).toBeTruthy();
    await user.click(within(modal).getByTestId('entity-done'));
    await waitFor(() => expect(screen.queryByTestId('entity-modal')).toBeNull());

    cleanup();
    const again = await openEditor(reloaded(h.last()));
    await again.select(KEY);
    await user.click(screen.getByTestId('entity-configure'));
    const reopened = screen.getByTestId('entity-modal');
    expect(within(reopened).getByTestId('entity-any').textContent).toContain('Verwaltung');
    expect(within(reopened).getByTestId('entity-self').textContent).toContain('Bauhof');
  });
});

describe('Teilnehmende: "Nur Selbstauswahl" and "Kann jeden auswählen" write the constraint', () => {
  it('writes the register shape, says what the other roles may, and reads back', async () => {
    const h = await selectorField();
    await user.click(radio('participants'));
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    expect(within(modal).getByTestId('entity-summary').textContent).toBe(
      'Alle Rollen können jeden auswählen.',
    );

    await pick('entity-any', /Verwaltung/);
    expect(h.entry(KEY)?.constraint).toBe("value == actor.id || 'verwaltung' in actor.roles");
    expect(h.entry(KEY)?.constraint_message).toEqual({ de: 'Nur die eigene Person darf ausgewählt werden.' });
    expect(within(modal).getByTestId('entity-summary').textContent).toBe(
      'Alle übrigen Rollen können nur sich selbst auswählen.',
    );

    await pick('entity-self', /Bauhof/);
    expect(h.entry(KEY)?.constraint).toBe(
      "value == actor.id || 'verwaltung' in actor.roles || !('bauhof' in actor.roles)",
    );
    expect(within(modal).getByTestId('entity-summary').textContent).toBe(
      'Alle übrigen Rollen können jeden auswählen.',
    );
    expect(screen.getByTestId('entity-configured')).toBeTruthy();

    await user.click(within(modal).getByTestId('entity-done'));
    await waitFor(() => expect(screen.queryByTestId('entity-modal')).toBeNull());

    cleanup();
    const again = await openEditor(reloaded(h.last()));
    await again.select(KEY);
    await user.click(screen.getByTestId('entity-configure'));
    const reopened = screen.getByTestId('entity-modal');
    expect(within(reopened).getByTestId('entity-any').textContent).toContain('Verwaltung');
    expect(within(reopened).getByTestId('entity-self').textContent).toContain('Bauhof');
  });

  it('an empty role picker means every role (v3 said "niemand" for one of them)', async () => {
    await selectorField();
    await user.click(radio('participants'));
    await user.click(screen.getByTestId('entity-configure'));
    const modal = screen.getByTestId('entity-modal');
    expect(within(modal).getByTestId('entity-any').textContent).toContain('Rollen');
    expect(within(modal).queryByText(/niemand/i)).toBeNull();
  });

  it('a hand-written constraint shows as read-only and is not overwritten', async () => {
    const hand = 'value != actor.id';
    const h = await selectorField();
    await user.click(radio('participants'));
    cleanup();
    const doc = h
      .last()
      .apply({ kind: 'set', path: `tasks.${TASK}.form.${KEY}.constraint`, value: hand }).doc;
    const again = await openEditor(doc);
    await again.select(KEY);
    await user.click(screen.getByTestId('entity-configure'));
    expect(screen.getByTestId('entity-foreign').textContent).toBe(hand);
    expect(screen.queryByTestId('entity-any')).toBeNull();
    expect(again.entry(KEY)?.constraint ?? hand).toBe(hand);
  });
});
