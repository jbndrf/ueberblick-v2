// @vitest-environment jsdom
// v3's relation path and relation list (RelationPath.svelte, RelationList.svelte), over the small world of `fixtures.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Instant } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { createRelationNav } from './nav';
import { deps, world, type Node } from './fixtures';
import RelationList from './RelationList.svelte';
import RelationPath from './RelationPath.svelte';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('style'); // an open menu leaves pointer-events: none on the body in jsdom
});
const f = (s: string): FeatureId => s as FeatureId;
/** jsdom: the open menu sets pointer-events none on the body, so open with the keyboard and click the item directly. */
// jsdom lays the floating menu out hidden, so the items are found with hidden: true.
async function openMenu(name: string): Promise<void> {
  screen.getByRole('button', { name }).focus();
  await userEvent.keyboard('{Enter}');
}
/** The item whose text matches (jsdom computes no accessible name for the floating menu's items). */
async function menuItem(text: string | RegExp): Promise<HTMLElement> {
  const items = await screen.findAllByRole('menuitem', { hidden: true });
  const hit = items.find((i) =>
    typeof text === 'string' ? i.textContent?.trim() === text : text.test(i.textContent ?? ''),
  );
  if (hit === undefined) throw new Error('no menu item ' + String(text));
  return hit;
}
const NOW = '2026-10-01T12:00:00Z' as Instant;

const WORLD: Record<string, Node> = {
  g1: { type: 'gebiet', label: 'Nord' },
  lone: { type: 'baum', label: 'Einzeln' },
  b1: {
    type: 'baum',
    label: 'Eiche',
    stage: 'neu',
    parents: [['gebiet', 'g1']],
    tasks: ['massnahme_anlegen'],
  },
  b2: { type: 'baum', label: 'Linde', stage: 'fertig', parents: [['gebiet', 'g1']] },
  b3: { type: 'baum', label: 'Ahorn', stage: 'neu', parents: [['gebiet', 'g1']] },
  m1: {
    type: 'massnahme',
    label: 'Schnitt',
    stage: 'offen',
    parents: [['baum', 'b1']],
    tasks: ['massnahme_erledigen'],
  },
};

function path(id: string, over: Record<string, unknown> = {}) {
  const nav = createRelationNav(deps(world(WORLD).source));
  const calls = {
    open: vi.fn(),
    opengroup: vi.fn(),
    closegroup: vi.fn(),
    create: vi.fn(),
    chain: vi.fn(),
  };
  render(RelationPath, {
    nav,
    id: f(id),
    title: 'Baum',
    locale: 'de',
    openGroup: undefined,
    chains: nav.chains(f(id)),
    chainIndex: 0,
    openWork: (p: FeatureId, g?: string) => nav.openWork(p, g),
    onselectchain: calls.chain,
    onopen: calls.open,
    onopengroup: calls.opengroup,
    onclosegroup: calls.closegroup,
    oncreate: calls.create,
    ...over,
  });
  return { nav, calls };
}

describe('the relation path', () => {
  it('a feature without parents or children shows just its title', () => {
    path('lone');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the parent chain; tapping a parent opens it', async () => {
    const { calls } = path('b1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Gebiet' }));
    expect(calls.open).toHaveBeenCalledWith('g1');
  });

  it('the relation segment opens that relation of the parent, with the open-work count', async () => {
    const { calls } = path('b1');
    const relation = screen.getByRole('button', { name: /Bäume/ });
    expect(within(relation).getByLabelText('1 mit offenen Aufgaben für Sie')).toBeTruthy();
    await userEvent.setup().click(relation);
    expect(calls.opengroup).toHaveBeenCalledWith('g1', 'baum.gebiet');
  });

  it('the current level lists its own relations with counts; zero children offers "anlegen"', async () => {
    const nav = createRelationNav(deps(world({ ...WORLD, m1: { ...(WORLD['m1'] as Node) } }).source));
    const { calls } = path('b1');
    expect(nav.groups(f('b1')).length).toBe(1);
    await openMenu('Verknüpfte Objekte');
    const item = await menuItem(/Maßnahme/);
    expect(item.textContent).toContain('1');
    fireEvent.click(item);
    expect(calls.opengroup).toHaveBeenCalledWith('b1', 'massnahme.baum');
  });

  it('a relation with no child yet shows "{name} anlegen" and creates', async () => {
    const lonely = { b1: { type: 'baum', stage: 'neu', tasks: ['massnahme_anlegen'] } } as Record<
      string,
      Node
    >;
    const nav = createRelationNav(deps(world(lonely).source));
    const calls = { create: vi.fn() };
    render(RelationPath, {
      nav,
      id: f('b1'),
      title: 'Baum',
      locale: 'de',
      openGroup: undefined,
      chains: [],
      chainIndex: 0,
      openWork: () => 0,
      onselectchain: () => undefined,
      onopen: () => undefined,
      onopengroup: () => undefined,
      onclosegroup: () => undefined,
      oncreate: calls.create,
    });
    await openMenu('Verknüpfte Objekte');
    fireEvent.click(await menuItem('Maßnahme anlegen'));
    expect(calls.create).toHaveBeenCalledWith('massnahme.baum');
  });

  it('an open relation: the feature segment closes it, the relation is the heading', async () => {
    const { calls } = path('b1', { openGroup: 'massnahme.baum' });
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('Maßnahme');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Baum' }));
    expect(calls.closegroup).toHaveBeenCalled();
  });

  it('several parents: the first segment has a switcher listing every chain', async () => {
    const two = {
      ...WORLD,
      g2: { type: 'gebiet', label: 'Süd' },
      b1: {
        ...(WORLD['b1'] as Node),
        parents: [
          ['gebiet', 'g1'],
          ['gebiet', 'g2'],
        ],
      },
    } as Record<string, Node>;
    const nav = createRelationNav(deps(world(two).source));
    const chain = vi.fn();
    render(RelationPath, {
      nav,
      id: f('b1'),
      title: 'Baum',
      locale: 'de',
      openGroup: undefined,
      chains: nav.chains(f('b1')),
      chainIndex: 0,
      openWork: () => 0,
      onselectchain: chain,
      onopen: () => undefined,
      onopengroup: () => undefined,
      onclosegroup: () => undefined,
      oncreate: () => undefined,
    });
    await openMenu('Übergeordnetes Objekt wechseln');
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    expect(items).toHaveLength(2);
    fireEvent.click(items[1] as HTMLElement);
    expect(chain).toHaveBeenCalledWith(1);
  });

  it('a long path collapses its middle; the dots show it all', async () => {
    const deep: Record<string, Node> = {};
    for (let i = 0; i < 4; i++)
      deep[`n${i}`] = { type: 'baum', label: `n${i}`, parents: i < 3 ? [['gebiet', `n${i + 1}`]] : [] };
    const nav = createRelationNav(deps(world(deep).source));
    render(RelationPath, {
      nav,
      id: f('n0'),
      title: 'Baum',
      locale: 'de',
      openGroup: undefined,
      chains: nav.chains(f('n0')),
      chainIndex: 0,
      openWork: () => 0,
      onselectchain: () => undefined,
      onopen: () => undefined,
      onopengroup: () => undefined,
      onclosegroup: () => undefined,
      oncreate: () => undefined,
    });
    const dots = screen.getByRole('button', { name: 'Ganzen Pfad anzeigen' });
    expect(screen.getAllByRole('button')).toHaveLength(3); // the first parent, the dots, the last relation
    await userEvent.setup().click(dots);
    expect(screen.queryByRole('button', { name: 'Ganzen Pfad anzeigen' })).toBeNull();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(3);
  });
});

describe('the relation list', () => {
  function list(over: Record<string, unknown> = {}) {
    const nav = createRelationNav(deps(world(WORLD).source));
    const calls = { create: vi.fn(), open: vi.fn() };
    render(RelationList, {
      nav,
      parent: f('g1'),
      group: 'baum.gebiet',
      locale: 'de',
      now: NOW,
      create: undefined,
      leads: (id: FeatureId) => nav.leadsToOpenWork(id),
      oncreate: calls.create,
      onopen: calls.open,
      ...over,
    });
    return calls;
  }

  it('lists the children: open work first, finished last and greyed, stage and time under the label', async () => {
    const calls = list();
    const rows = screen.getAllByTestId('relation-row');
    expect(rows.map((r) => r.querySelector('span span')?.textContent)).toEqual(['Eiche', 'Ahorn', 'Linde']);
    expect(rows[2]?.getAttribute('data-finished')).toBe('true');
    expect(rows[0]?.textContent).toContain('Neu · vor 2 Std');
    expect(within(rows[0] as HTMLElement).getByRole('img', { name: 'Offene Aufgaben für Sie' })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole('img')).toBeNull();
    await userEvent.setup().click(rows[0] as HTMLElement);
    expect(calls.open).toHaveBeenCalledWith('b1');
  });

  it('shows the labelled create button when creating is offered', async () => {
    const calls = list({ create: { task: 'massnahme_anlegen', name: 'Baum' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Baum anlegen' }));
    expect(calls.create).toHaveBeenCalled();
  });

  it('says so when a relation has no child', () => {
    list({ group: 'massnahme.baum' });
    expect(screen.getByText('Noch keine Objekte')).toBeTruthy();
  });
});
