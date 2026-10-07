// @vitest-environment jsdom
// WP-623: a task without a form submits on tap and the sheet follows the device; a task with a form is handed on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import type { StoredRun } from '@ueberblick/client';
import { goldenConfig } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import { createDeviceIds } from '../ids';
import { createReader, type ActivitySource } from '../reader';
import FeatureSheetHost from './FeatureSheetHost.svelte';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('style'); // an open menu leaves pointer-events: none on the body in jsdom
});
beforeEach(() => {
  window.innerWidth = 480;
});

const golden = goldenConfig('templates/baumkataster/1.0.0.yaml');
// The golden Baum declares no child list; the path needs the parent side to declare it (`inverse_of`, WP-647).
const baum = golden.file.types?.['baum'];
const config = {
  ...golden,
  file: {
    ...golden.file,
    types: {
      ...golden.file.types,
      baum: {
        ...baum,
        relations: { ...baum?.relations, massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum' } },
      },
    },
  },
} as typeof golden;
const at = () => '2026-10-01T12:00:00Z' as Instant;
const tree: FeatureState = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  properties: { stage: 'massnahme', beschreibung: 'Alte Eiche' } as never,
  lifecycle: 'active',
  updatedSeq: 3,
};
let measure: FeatureState;
const facts: Facts = {
  feature: (id) => (id === tree.id ? tree : id === measure.id ? measure : undefined),
  near: () => [],
  ofType: () => [],
  edgesFrom: (id) =>
    id === 'm1' ? [{ from: 'm1' as FeatureId, relation: 'baum' as Key, to: tree.id, derived: false }] : [],
  edgesTo: (id) =>
    id === 't1' ? [{ from: 'm1' as FeatureId, relation: 'baum' as Key, to: tree.id, derived: false }] : [],
  history: () => [],
  observationsByActor: () => [],
  featuresWith: () => [],
  createdBy: () => 0,
};

const discard = vi.fn(async () => undefined);
const resubmit = vi.fn(async () => ({ ok: true }));
const noActivity: ActivitySource = {
  activityWarm: () => false,
  warmActivity: () => Promise.resolve(),
  observationsOf: () => [],
  runMeta: () => undefined,
  personName: () => undefined,
  queuedRunsOf: () => [],
  plannedChangesOf: () => [],
};

interface Setup {
  /** The feature the sheet opens on. */
  readonly open?: string;
  readonly role?: string;
  readonly runs?: StoredRun[];
}

function setup({ open = 'm1', role = 'bauhof', runs = [] }: Setup = {}) {
  measure = {
    id: 'm1' as FeatureId,
    type: 'massnahme' as Key,
    properties: { baum: 't1', art: 'schnitt', erledigt_am: null } as never,
    lifecycle: 'active',
    updatedSeq: 4,
  };
  const actor: Actor = { id: 'anna', kind: 'participant', roles: [role as Key] };
  const ids = createDeviceIds({ now: at }, (n) => new Uint8Array(n));
  const reader = createReader({
    facts,
    versions: { deployed: 1, get: () => config },
    bootstrapVersion: 1,
    actor,
    geo: createGeo(),
    clock: { now: at },
    ids,
    locale: 'de',
    activity: noActivity,
    actorName: 'Anna',
  });
  let ring: () => void = () => undefined;
  const changed = {
    subscribe: (l: () => void) => {
      ring = l;
      return () => undefined;
    },
    stop: () => undefined,
  };
  const submit = vi.fn(async () => {
    // the queue predicts the run: the measure is done on this device
    measure = { ...measure, properties: { ...measure.properties, erledigt_am: '2026-10-01' } as never };
    ring();
    return 'queued' as const;
  });
  const device = {
    reader,
    config,
    actor,
    ids,
    clock: { now: at },
    submitter: { submit, outcome: () => () => undefined },
    changed,
    store: { readRuns: async () => runs },
    queue: {
      status: () => ({ retryInMs: undefined, sending: undefined }),
      subscribe: () => () => undefined,
      discard: discard,
      resubmit: resubmit,
    },
  };
  const onform = vi.fn();
  const onopen = vi.fn();
  const isolate = vi.fn();
  const view = render(FeatureSheetHost, {
    device: device as never,
    featureId: open as FeatureId,
    locale: 'de',
    open: true,
    onclose: () => undefined,
    onform,
    onopen,
    isolate,
  });
  return { submit, onform, onopen, isolate, view };
}

describe('feature sheet on the device', () => {
  it('shows the Objektart of the tapped feature and its available task', async () => {
    setup();
    expect((await screen.findByRole('heading', { level: 3 })).textContent).toBe('Maßnahme');
    expect(screen.getByRole('button', { name: 'Maßnahme erledigen' })).toBeTruthy();
  });

  it('a task without a form submits on tap; the sheet then no longer offers it', async () => {
    const { submit, onform } = setup();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Maßnahme erledigen' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'massnahme_erledigen', featureId: 'm1', input: {} }),
    );
    expect(onform).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Maßnahme erledigen' })).toBeNull());
  });
});

// WP-647: where the feature sits, its relations, and the run notices.
describe('relation path, relation level and run notices on the device', () => {
  const refused = (): StoredRun => ({
    order: 1,
    blobs: [],
    blobMimes: {},
    state: 'refused',
    refusal: { code: 'validation', message: 'Zu hoch' } as never,
    run: {
      id: 'r1' as never,
      task: 'massnahme_erledigen' as Key,
      actor: { id: 'anna', kind: 'participant', roles: [] },
      configVersion: 1,
      featureId: 'm1' as FeatureId,
      input: {},
    },
  });

  it('a Maßnahme shows its parent (the Baum) in the header; a tap opens the Baum', async () => {
    const { onopen } = setup();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Baum' }));
    expect(onopen).toHaveBeenCalledWith('t1');
  });

  it('the Baum lists its Maßnahmen in the header menu, with the open work behind them', async () => {
    setup({ open: 't1' });
    const trigger = await screen.findByRole('button', { name: 'Verknüpfte Objekte' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    expect(items.map((i) => i.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Maßnahme 1 1']);
    // the count follows once the sheet is open (never in the opening frame)
    await waitFor(() => expect(screen.getAllByTestId('relation-open-work').length).toBeGreaterThan(0));
  });

  it('opening the relation replaces the body with the children; a child opens with the Baum as its parent', async () => {
    const { onopen } = setup({ open: 't1' });
    const trigger = await screen.findByRole('button', { name: 'Verknüpfte Objekte' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const [item] = await screen.findAllByRole('menuitem', { hidden: true });
    await fireEvent.click(item as HTMLElement);
    const rows = await screen.findAllByTestId('relation-row');
    expect(rows).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: 'Daten' })).toBeNull();
    await fireEvent.click(rows[0] as HTMLElement);
    expect(onopen).toHaveBeenCalledWith('m1');
  });

  it('a task that creates a child under this Objekt is "anlegen" in the menu, not in the action row', async () => {
    setup({ open: 't1', role: 'kontrolle' });
    await screen.findByRole('button', { name: 'Verknüpfte Objekte' });
    expect(screen.queryByRole('button', { name: 'Maßnahme anlegen' })).toBeNull();
  });

  it('the refused runs of this Objekt are on the sheet with Erneut senden and Verwerfen', async () => {
    setup({ runs: [refused()] });
    const box = await screen.findByTestId('run-refused');
    expect(box.textContent).toContain('Maßnahme erledigen');
    await userEvent.setup().click(within(box).getByRole('button', { name: 'Verwerfen' }));
    expect(discard).toHaveBeenCalledWith('r1');
  });

  // v3 `onFocusRelation` (Module :447-455): the map shows only the children of the relation in view.
  it('opening a relation draws only its children on the map; leaving it ends that', async () => {
    const { isolate } = setup({ open: 't1' });
    const trigger = await screen.findByRole('button', { name: 'Verknüpfte Objekte' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const [item] = await screen.findAllByRole('menuitem', { hidden: true });
    await fireEvent.click(item as HTMLElement);
    await screen.findAllByTestId('relation-row');
    expect(isolate).toHaveBeenLastCalledWith(['m1']);
    await fireEvent.click(await screen.findByRole('button', { name: 'Baum' }));
    await waitFor(() => expect(isolate).toHaveBeenLastCalledWith(null));
  });

  it('a feature reached through a relation keeps its siblings drawn; closing the sheet ends it', async () => {
    const { isolate, view } = setup({ open: 'm1' });
    await screen.findByRole('button', { name: 'Baum' });
    expect(isolate).toHaveBeenLastCalledWith(['m1']);
    view.unmount();
    expect(isolate).toHaveBeenLastCalledWith(null);
  });

  // WP-748: a feature this device does not hold says so once (title only), not twice.
  it('a feature not on this device shows its notice once', async () => {
    setup({ open: 'gone' });
    await screen.findByRole('dialog');
    expect(screen.getAllByText('Dieses Objekt liegt nicht auf diesem Gerät.')).toHaveLength(1);
  });
});
