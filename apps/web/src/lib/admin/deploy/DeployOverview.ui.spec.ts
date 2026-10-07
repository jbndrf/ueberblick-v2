// @vitest-environment jsdom
// WP-360 acceptance: the deploy overview (v3 `fork/+page.svelte:160-331`) opened by "Veröffentlichen".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { diff, type TemplateFile } from '@ueberblick/core';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { DeployClient } from './deploy-client';
import DeployOverview from './DeployOverview.svelte';
import { groupsOf } from './plan-view';
import { deployOverview } from './overview-store.svelte';
import type { DeployAnswer, DeployPlan, MappingView, PlanGroup } from './types';

afterEach(() => {
  cleanup();
  deployOverview.open = false;
  deployOverview.published = null;
  document.body.style.pointerEvents = '';
});

const baum = (over: Partial<PlanGroup> = {}): PlanGroup => ({
  type: 'baum',
  label: 'Baum',
  isNew: false,
  isRemoved: false,
  objects: 9,
  entries: [
    { path: 'types.baum.properties.vitalitaet', change: 'added', breaking: false, name: 'Vitalität' },
  ],
  ...over,
});
const PLAN = (over: Partial<DeployPlan> = {}): DeployPlan => ({
  revision: 4,
  first: false,
  warnings: [],
  groups: [baum()],
  versions: [],
  mappings: [],
  blockers: [],
  ...over,
});

const STAGE_PATH = 'types.baum.properties.stage.options.massnahme';
const STAGE_ROW: MappingView = {
  path: STAGE_PATH,
  name: 'Maßnahme',
  type: 'baum',
  stage: true,
  affected: 4,
  choices: [
    { key: 'erfasst', label: 'Erfasst' },
    { key: 'erledigt', label: 'Erledigt' },
  ],
};
const STAGE_GROUP = baum({
  entries: [
    { path: STAGE_PATH, change: 'removed', breaking: true, affected: 4, name: 'Maßnahme', stage: true },
  ],
});
const RUNNING = { type: 'baum', running_floating: 3, already_pinned: 1, settled_floating: 2 };

function mount(plans: DeployPlan | DeployPlan[], opts: { answer?: DeployAnswer; locale?: Locale } = {}) {
  const list = Array.isArray(plans) ? plans : [plans];
  let n = 0;
  const plan = vi.fn(async () => list[Math.min(n++, list.length - 1)] ?? null);
  const deploy = vi.fn(async () => opts.answer ?? ({ kind: 'deployed', version: 5 } as DeployAnswer));
  const client: DeployClient = {
    plan,
    deploy,
    preview: async () => ({ status: 'dropped' as const, logins: [] }),
    resetPreview: async () => null,
    compare: async () => null,
  };
  const ongoto = vi.fn();
  const onpublished = vi.fn();
  render(DeployOverview, { locale: opts.locale ?? 'de', client, ongoto, onpublished });
  deployOverview.show();
  return { plan, deploy, ongoto, onpublished };
}
const confirmButton = () => screen.getByRole('button', { name: 'Veröffentlichen' }) as HTMLButtonElement;

describe('the simple case: no breaking change, no running Objekte', () => {
  it('shows the diff per Objektart in plain words and confirms in one click', async () => {
    const { deploy, onpublished } = mount(PLAN());
    const group = await screen.findByTestId('deploy-group');
    expect(group.textContent).toContain('Baum');
    expect(group.textContent).toContain('Keine tiefgreifenden Änderungen');
    expect(group.textContent).toContain('9 Objekte');
    expect(group.textContent).toContain('Eigenschaft „Vitalität“ hinzugefügt');
    expect(screen.queryByRole('radio')).toBeNull(); // v3 showed it only when running cases exist
    expect(screen.queryByTestId('deploy-remap')).toBeNull();
    await userEvent.click(confirmButton());
    expect(deploy).toHaveBeenCalledWith({ revision: 4, mappings: {}, versions: {} });
    await waitFor(() => expect(onpublished).toHaveBeenCalledWith(5));
    expect(deployOverview.published).toBe(5);
    expect(deployOverview.open).toBe(false);
  });

  it('an order-only Objektart shows the order line and no Objekte count (WP-411)', async () => {
    const type = (props: Record<string, unknown>) => ({
      label: { de: 'Baum' },
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: props,
    });
    const a = { type: 'text', label: { de: 'A' } };
    const b = { type: 'text', label: { de: 'B' } };
    const file = (props: Record<string, unknown>) =>
      ({
        schema: 'ueberblick/1',
        template: { key: 'k', version: '1.0.0' },
        roles: {},
        types: { baum: type(props) },
        tasks: {},
      }) as unknown as TemplateFile;
    const before = file({ a, b });
    const after = file({ b, a });
    const groups = groupsOf({
      before,
      after,
      diff: diff(before, after),
      versions: [],
      affected: [], // a reorder touches no Objekt: `buildPlan` lists none (plan-order.spec.ts)
      locale: 'de',
    });
    mount(PLAN({ groups }));
    const group = await screen.findByTestId('deploy-group');
    expect(group.textContent).toContain('Objektart „Baum“: Reihenfolge der Eigenschaften geändert');
    expect(group.textContent).toContain('Keine tiefgreifenden Änderungen');
    expect(group.textContent).not.toContain('Objekte');
  });

  it('Abbrechen closes it and deploys nothing', async () => {
    const { deploy } = mount(PLAN());
    await screen.findByTestId('deploy-group');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(deployOverview.open).toBe(false);
    expect(deploy).not.toHaveBeenCalled();
  });

  it('no changes: v3 text and no confirm', async () => {
    mount(PLAN({ groups: [] }));
    expect(await screen.findByText('Noch keine Änderungen zum Veröffentlichen.')).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });

  it('the first publish says so, shows each Objektart as "neu" and confirms', async () => {
    mount(PLAN({ first: true, groups: [baum({ isNew: true, entries: [] })] }));
    expect(await screen.findByText('Projekt veröffentlichen')).toBeTruthy();
    expect(screen.getByTestId('deploy-group').textContent).toContain('neu');
    expect(confirmButton().disabled).toBe(false);
  });
});

describe('a removed stage with Objekten: "verschieben nach" or "Werte verwerfen"', () => {
  const plan = () => PLAN({ groups: [STAGE_GROUP], mappings: [STAGE_ROW] });

  it('asks for a target with the affected count; the confirm waits for it', async () => {
    mount(plan());
    const remap = await screen.findByTestId('deploy-remap');
    expect(remap.textContent).toContain('Phase');
    expect(remap.textContent).toContain('Maßnahme');
    expect(remap.textContent).toContain('4 Objekte betroffen');
    expect(screen.getByTestId('deploy-group').textContent).toContain('Phase „Maßnahme“ entfernt');
    expect(screen.getByTestId('deploy-group').textContent).toContain('Tiefgreifende Änderung');
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByText(/Wählen Sie für jeden Eintrag oben ein Ziel/)).toBeTruthy();
  });

  it('a chosen target is sent as { to }', async () => {
    const { deploy } = mount(plan());
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['—', 'Erfasst', 'Erledigt', 'Werte verwerfen']);
    await userEvent.selectOptions(select, 'Erfasst');
    expect(confirmButton().disabled).toBe(false);
    await userEvent.click(confirmButton());
    expect(deploy).toHaveBeenCalledWith({
      revision: 4,
      mappings: { [STAGE_PATH]: { to: 'erfasst' } },
      versions: {},
    });
  });

  it('"Werte verwerfen" is sent as { discard }', async () => {
    const { deploy } = mount(plan());
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Werte verwerfen');
    await userEvent.click(confirmButton());
    expect(deploy).toHaveBeenCalledWith({
      revision: 4,
      mappings: { [STAGE_PATH]: { discard: true } },
      versions: {},
    });
  });

  it('an entry that no Objekt holds needs no pick and is sent as discard', async () => {
    const { deploy } = mount(PLAN({ groups: [STAGE_GROUP], mappings: [{ ...STAGE_ROW, affected: 0 }] }));
    await screen.findByTestId('deploy-group');
    expect(screen.queryByTestId('deploy-remap')).toBeNull();
    await userEvent.click(confirmButton());
    expect(deploy).toHaveBeenCalledWith({
      revision: 4,
      mappings: { [STAGE_PATH]: { discard: true } },
      versions: {},
    });
  });
});

describe('running Objekte: "belassen / verschieben"', () => {
  const plan = () => PLAN({ versions: [RUNNING] });

  it('shows the radio with the three counts; "verschieben" is the default', async () => {
    const { deploy } = mount(plan());
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Laufende Objekte auf ihrer aktuellen Version belassen \(Legacy\)/)).toBeTruthy();
    expect(screen.getByTestId('deploy-choice-counts').textContent).toContain(
      '3 laufend, 1 schon auf älterer Version, 2 abgeschlossen oder archiviert',
    );
    await userEvent.click(confirmButton());
    expect(deploy).toHaveBeenCalledWith({ revision: 4, mappings: {}, versions: { baum: 'move' } });
  });

  it('"belassen" re-plans with the choice and deploys with versions { baum: keep }', async () => {
    const { plan: planCall, deploy } = mount(plan());
    await userEvent.click((await screen.findAllByRole('radio'))[0] as HTMLElement);
    await waitFor(() => expect(planCall).toHaveBeenLastCalledWith({ baum: 'keep' }, 'de'));
    await userEvent.click(confirmButton());
    expect(deploy).toHaveBeenCalledWith({ revision: 4, mappings: {}, versions: { baum: 'keep' } });
  });

  it('kept and nothing settled: the removed stage needs no pick (its Objekte stay on the old version)', async () => {
    const only = { ...RUNNING, settled_floating: 0 };
    mount(PLAN({ groups: [STAGE_GROUP], mappings: [STAGE_ROW], versions: [only] }));
    await userEvent.click((await screen.findAllByRole('radio'))[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('deploy-remap')).toBeNull());
    expect(confirmButton().disabled).toBe(false);
  });
});

describe('blockers', () => {
  const blocker = {
    id: '0:x',
    path: 'types.baum.properties.art.to',
    message: 'Art zeigt ins Leere',
    type: 'baum',
  };

  it('list "Behebe zuerst" with "Gehe zu", and hold the confirm', async () => {
    const { deploy, ongoto } = mount(PLAN({ blockers: [blocker] }));
    const box = await screen.findByTestId('deploy-blockers');
    expect(box.textContent).toContain('Behebe zuerst:');
    expect(box.textContent).toContain('Art zeigt ins Leere');
    expect(confirmButton().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Gehe zu' }));
    expect(ongoto).toHaveBeenCalledWith(blocker);
    expect(deployOverview.open).toBe(false);
    expect(deploy).not.toHaveBeenCalled();
  });
});

describe('after the click', () => {
  it('a draft changed meanwhile says so and reads the plan again', async () => {
    const { plan, deploy } = mount([PLAN(), PLAN({ revision: 5 })], { answer: { kind: 'stale' } });
    await screen.findByTestId('deploy-group');
    await userEvent.click(confirmButton());
    expect(await screen.findByText(/Der Entwurf wurde inzwischen geändert/)).toBeTruthy();
    await waitFor(() => expect(plan).toHaveBeenCalledTimes(2));
    await userEvent.click(await waitFor(() => confirmButton()));
    expect(deploy).toHaveBeenLastCalledWith({ revision: 5, mappings: {}, versions: {} });
  });

  it('a failed deploy keeps the overview open with the error', async () => {
    mount(PLAN(), { answer: { kind: 'failed' } });
    await screen.findByTestId('deploy-group');
    await userEvent.click(confirmButton());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Das Veröffentlichen ist fehlgeschlagen',
    );
    expect(deployOverview.open).toBe(true);
  });

  it('shows progress while the deploy runs', async () => {
    let release: (a: DeployAnswer) => void = () => undefined;
    const client: DeployClient = {
      plan: async () => PLAN(),
      deploy: () => new Promise<DeployAnswer>((r) => (release = r)),
      preview: async () => ({ status: 'dropped' as const, logins: [] }),
      resetPreview: async () => null,
      compare: async () => null,
    };
    render(DeployOverview, { locale: 'de', client, ongoto: vi.fn(), onpublished: vi.fn() });
    deployOverview.show();
    await screen.findByTestId('deploy-group');
    await userEvent.click(confirmButton());
    const busy = await screen.findByRole('button', { name: /Wird veröffentlicht/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    release({ kind: 'deployed', version: 2 });
    await waitFor(() => expect(deployOverview.published).toBe(2));
  });

  it('a plan that cannot be read says so', async () => {
    mount([]);
    expect((await screen.findByRole('alert')).textContent).toContain('konnten nicht gelesen werden');
  });
});

describe('English', () => {
  it('uses the English catalogue', async () => {
    mount(PLAN({ versions: [RUNNING] }), { locale: 'en' });
    const group = await screen.findByTestId('deploy-group');
    expect(within(group).getByText(/Leave running objects on their current version/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });
});

describe('Vorschau-Logins (WP-373, v3 fork page card)', () => {
  it('lists the preview logins under the changes', async () => {
    const preview = vi.fn(async () => ({
      status: 'ready' as const,
      logins: [
        { role: null, label: '', participantId: 'preview-g1-none', token: 'T-1', link: '/login?token=T-1' },
      ],
    }));
    const client: DeployClient = {
      plan: async () => PLAN(),
      deploy: async () => ({ kind: 'deployed', version: 2 }),
      preview,
      resetPreview: async () => null,
      compare: async () => null,
    };
    render(DeployOverview, { locale: 'de', client, ongoto: vi.fn(), onpublished: vi.fn() });
    deployOverview.show();
    const card = await screen.findByTestId('preview-logins');
    expect(await within(card).findByText('Keine Rolle')).toBeTruthy();
    expect(preview).toHaveBeenCalledWith('de');
  });
});
