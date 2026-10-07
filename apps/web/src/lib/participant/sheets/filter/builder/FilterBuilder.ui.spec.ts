// @vitest-environment jsdom
// The view builder (WP-665, v3 FilterBuilder): the field picker, the four editors, the "other" rows, the creators by
// name, and what each edit writes (rule-language source, compiled by core and evaluated by core).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { applyFilter, compileFilter, type FilterSource } from '@ueberblick/core/filters';
import type { FeatureState, Key } from '@ueberblick/core/model';
import { compilePerms } from '@ueberblick/core/perms';
import { goldenConfig } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import ViewBuilder from './ViewBuilder.svelte';
import { builderPort } from './port';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const actor = { id: 'u1', kind: 'participant' as const, roles: ['kontrolle' as Key] };
const tree = (id: string, by: string | undefined): FeatureState =>
  ({
    id,
    type: 'baum',
    properties: {},
    lifecycle: 'active',
    updatedSeq: 1,
    createdBy: by,
  }) as unknown as FeatureState;
const features = [tree('1', 'u1'), tree('2', 'u2'), tree('3', 'u3'), tree('4', 'u2')];

const port = () =>
  builderPort({
    config,
    actor,
    locale: 'de',
    features: () => features,
    nameOf: (id) => ({ u1: 'Berta', u2: 'Anton' })[id],
    unknown: 'Jemand',
  });

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

function mount(filters: FilterSource = {}) {
  const saved: FilterSource[] = [];
  const view = render(ViewBuilder, {
    port: port(),
    filters,
    locale: 'de',
    onsave: (f: FilterSource) => saved.push(f),
  });
  return { saved, last: () => saved.at(-1), ...view };
}

afterEach(() => cleanup());

describe.each([
  ['phone 390px', 390],
  ['desktop 1280px', 1280],
])('the view builder at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  // The kit lists the rows as options in the dropdown and as checkboxes in the phone's full-screen dialog.
  const optionRole = width < 768 ? 'checkbox' : 'option';
  const pick = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
    await user.click(screen.getByRole('button', { name: /Felder zum Filtern hinzufügen/ }));
    await user.click(
      await screen.findByRole(optionRole, { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}`) }),
    );
  };

  it('offers "Felder filtern" with the Objektart as description, v3 labels, and no file or stage field', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByText('Felder filtern')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Felder zum Filtern hinzufügen/ }));
    const names = (await screen.findAllByRole(optionRole)).map((o) => o.textContent ?? '');
    expect(names.some((n) => n.includes('Befund') && n.includes('Baum'))).toBe(true);
    expect(names.some((n) => n.includes('Höhe (m)'))).toBe(true);
    for (const hidden of ['Foto', 'Standort']) expect(names.join('|')).not.toContain(hidden);
  });

  it('a picked text field gets "Enthält…"; typing writes a rule-language term that core compiles', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Befund');
    const row = document.querySelector('[data-clause="field"]') as HTMLElement;
    expect(within(row).getByText('Baum')).toBeTruthy();
    await user.type(within(row).getByPlaceholderText('Enthält…'), 'Pilz');
    expect(last()).toEqual({ baum: '(self.befund.contains("Pilz"))' });
    expect(compileFilter(config, last() as FilterSource).ok).toBe(true);
  });

  it('a number field has Min and Max, either may stay open', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Höhe (m)');
    await user.type(screen.getByPlaceholderText('Min'), '5');
    expect(last()).toEqual({ baum: '(self.hoehe_m >= 5)' });
    await user.type(screen.getByPlaceholderText('Max'), '12');
    expect(last()).toEqual({ baum: '(self.hoehe_m >= 5 && self.hoehe_m <= 12)' });
    await user.clear(screen.getByPlaceholderText('Min'));
    expect(last()).toEqual({ baum: '(self.hoehe_m <= 12)' });
  });

  it('a date field has two day inputs', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Fällig am');
    await fireEvent.change(screen.getByLabelText('Von'), { target: { value: '2026-10-01' } });
    await fireEvent.change(screen.getByLabelText('Bis'), { target: { value: '2026-10-31' } });
    expect(last()).toEqual({
      baum: '(self.faellig_am >= date("2026-10-01") && self.faellig_am <= date("2026-10-31"))',
    });
  });

  it('a yes/no field has Ja and Nein; pressing the chosen one again clears it (WP-809)', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Kontrolle fällig');
    await user.click(screen.getByRole('button', { name: 'Ja' }));
    expect(last()).toEqual({ baum: '(self.kontrolle_faellig == true)' });
    await user.click(screen.getByRole('button', { name: 'Nein' }));
    expect(last()).toEqual({ baum: '(self.kontrolle_faellig == false)' });
    await user.click(screen.getByRole('button', { name: 'Nein' }));
    expect(last()).toEqual({});
  });

  it('a person field has "ich", written as the signed-in person (WP-809)', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Zuständig');
    await user.click(screen.getByRole('checkbox', { name: 'ich' }));
    expect(last()).toEqual({ baum: '(self.zustaendig == actor.id)' });
    expect(compileFilter(config, last() as FilterSource).ok).toBe(true);
  });

  it('a reference field has "ist leer" / "ist nicht leer" (WP-809)', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Baumart');
    await user.click(screen.getByRole('button', { name: 'ist nicht leer' }));
    expect(last()).toEqual({ baum: '(self.art != null)' });
    expect(compileFilter(config, last() as FilterSource).ok).toBe(true);
  });

  it('a localized text field has "ist leer" (WP-809)', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Beschreibung');
    await user.click(screen.getByRole('button', { name: 'ist leer' }));
    expect(last()).toEqual({ baum: '(self.beschreibung == null)' });
  });

  it('a choice field uses the kit MultiSelect "Beliebiger Wert" and writes a list', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await pick(user, 'Vitalität');
    const row = document.querySelector('[data-clause="field"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Beliebiger Wert/ }));
    await user.click(await screen.findByRole(optionRole, { name: '3' }));
    expect(last()).toEqual({ baum: '(self.vitalitaet in ["v3"])' });
  });

  it('removing a row removes its term; an empty row writes nothing', async () => {
    const user = userEvent.setup();
    const { last, saved } = mount({ baum: '(self.hoehe_m >= 5)' });
    expect(screen.getByPlaceholderText('Min')).toHaveProperty('value', '5');
    await user.click(screen.getByRole('button', { name: 'Bedingung entfernen' }));
    expect(last()).toEqual({});
    expect(saved.length).toBe(1);
  });

  it('"Weitere Bedingung hinzufügen" offers Stufe, Erstellungsdatum, Änderungsdatum and Erstellt von', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual([
      'Stufe',
      'Erstellungsdatum',
      'Änderungsdatum',
      'Erstellt von',
    ]);
  });

  it('Stufe: pick the Objektart, check stages', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await user.click(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stufe' }));
    const row = document.querySelector('[data-clause="stage"]') as HTMLElement;
    expect(within(row).getByRole('combobox')).toHaveProperty('value', 'baum');
    await user.click(within(row).getByRole('checkbox', { name: 'Erledigt' }));
    expect(last()).toEqual({ baum: '(self.stage in ["erledigt"])' });
  });

  it('Erstellungsdatum: older than 7 days by default, then between two days (the last day included)', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await user.click(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Erstellungsdatum' }));
    const row = document.querySelector('[data-clause="when"]') as HTMLElement;
    await fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '14' } });
    expect(last()?.['baum']).toBe('(self.$created_at < now - days(14))');
    await fireEvent.change(within(row).getAllByRole('combobox')[1] as HTMLElement, {
      target: { value: 'between' },
    });
    await fireEvent.change(within(row).getByLabelText('Bis'), { target: { value: '2026-10-05' } });
    expect(last()?.['baum']).toBe('(self.$created_at < date("2026-10-06"))');
  });

  it('Erstellt von lists the people by name, not by id, and writes their ids', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await user.click(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Erstellt von' }));
    const row = document.querySelector('[data-clause="created_by"]') as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-label') ?? b.parentElement?.textContent?.trim())).toEqual([
      'Anton',
      'Berta',
      'Jemand',
    ]);
    expect(row.textContent).not.toMatch(/u[123]\b/);
    await user.click(within(row).getByRole('checkbox', { name: 'Anton' }));
    expect(last()?.['baum']).toBe('(self.$created_by in ["u2"])');
  });

  it('the written view filters the features the way the rows say (evaluated by core)', async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await user.click(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Erstellt von' }));
    const row = document.querySelector('[data-clause="created_by"]') as HTMLElement;
    await user.click(within(row).getByRole('checkbox', { name: 'Anton' }));
    const compiled = compileFilter(config, last() as FilterSource);
    if (!compiled.ok) throw new Error('compile');
    const all = features;
    const env = {
      config,
      perms: compilePerms(config),
      actor,
      ctx: {
        vars: new Map(),
        features: {
          property: (id: string, key: string) =>
            key === '$created_by' ? all.find((f) => f.id === id)?.createdBy : undefined,
          related: () => [],
          history: () => [],
          type: () => 'baum',
        },
        now: '2026-10-01T08:00:00.000Z',
        relations: new Map(),
        geo: {} as never,
      },
    };
    const got = applyFilter(env as never, compiled.filter, 'baum', all).map((f) => f.id);
    expect(got).toEqual(['2', '4']);
  });

  it('a term the builder has no row for stays as a Regel row and is written back', async () => {
    const { last } = mount({ baum: "self.befund.startsWith('x') && self.hoehe_m >= 3" });
    expect(screen.getByText('Regel')).toBeTruthy();
    expect(screen.getByText("self.befund.startsWith('x')")).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Max'), '9');
    expect(last()?.['baum']).toBe(
      "(self.befund.startsWith('x')) && (self.hoehe_m >= 3 && self.hoehe_m <= 9)",
    );
  });

  it('has no accessibility violations with rows open', async () => {
    const user = userEvent.setup();
    const { container } = mount({ baum: '(self.hoehe_m >= 5)' });
    await user.click(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Erstellt von' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
