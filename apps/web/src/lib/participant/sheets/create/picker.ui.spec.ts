// @vitest-environment jsdom
// WP-652: the + picker as v3's WorkflowSelector draws it: the slideIn stagger, the left position beside Zuletzt, the
// quota hint with the disabled pills, the backdrop that also closes Zuletzt, and the bar that hides during the pin.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import { createGeo } from '@ueberblick/core/geo';
import type { MapHandle } from '@ueberblick/ui';
import CreateFlow from './CreateFlow.svelte';
import type { Pill } from './creatable';

afterEach(cleanup);

const pills: Pill[] = [
  { taskKey: 'a', label: 'Baum erfassen', onMap: true },
  { taskKey: 'b', label: 'Baumart anlegen', onMap: false },
  { taskKey: 'c', label: 'Fläche', onMap: false },
  { taskKey: 'd', label: 'Veranstaltung', onMap: false, draw: { kind: 'polygon', multi: false } },
  { taskKey: 'e', label: 'Hecke', onMap: false, draw: { kind: 'linestring', multi: false } },
];
const handle = {
  extent: () => [7, 50, 7.2, 50.2],
  onExtentChange: () => () => {},
  onMove: () => () => {},
  onMapTap: () => () => {},
  onMarkerDrag: () => () => {},
  addMarker: () => {},
  moveMarker: () => {},
  removeMarker: () => {},
  showOverlay: () => {},
  clearOverlay: () => {},
  unproject: () => [7.1, 50.1],
  setDoubleClickZoom: () => {},
  captureTaps: () => {},
  project: () => [0, 0],
} as unknown as MapHandle;

const flow = (over: Record<string, unknown> = {}) => {
  const props = {
    pills,
    handle,
    locale: 'de' as const,
    geo: createGeo(),
    open: true,
    onstart: vi.fn(),
    onclose: vi.fn(),
    onbackdrop: vi.fn(),
    onplacing: vi.fn(),
    ...over,
  };
  return { props, ...render(CreateFlow, props) };
};
const group = () => screen.getByTestId('create-picker');

describe('the picker as v3', () => {
  it('slides in: 0.2 s ease-out, each pill 0.03 s later than the one before', () => {
    flow();
    const items = screen.getAllByTestId('create-pill');
    expect(items.map((e) => e.style.animationDelay)).toEqual(['0s', '0.03s', '0.06s', '0.09s', '0.12s']);
    expect(items.every((e) => e.classList.contains('workflow-item'))).toBe(true);
  });

  it('is centred above the + by default and anchored left (left-4 md:left-16) beside Zuletzt', () => {
    const a = flow();
    expect(group().className).toContain('left-1/2');
    expect(group().className).not.toContain('md:left-16');
    a.unmount();
    flow({ position: 'left' });
    expect(group().className).toContain('left-4');
    expect(group().className).toContain('md:left-16');
    expect(group().className).not.toContain('left-1/2');
  });

  it('on a desktop sits 0.5rem below the real header (--ub-header-h), not at a fixed 4rem (WP-732; v3 md:top-16 = 3.5rem header + 0.5rem)', () => {
    flow();
    expect(group().className).toContain('md:top-[calc(var(--ub-header-h)+0.5rem)]');
    expect(group().className).not.toContain('md:top-16');
    expect(group().className).toContain('bottom-20'); // the phone layout is unchanged
  });

  it('the backdrop closes the picker and tells the host, which closes Zuletzt too', async () => {
    const { props } = flow();
    await fireEvent.click(screen.getByLabelText('Menü schließen'));
    expect(props.onclose).toHaveBeenCalledTimes(1);
    expect(props.onbackdrop).toHaveBeenCalledTimes(1);
  });

  it('quota reached: the hint shows, the pills are disabled and start nothing', async () => {
    const { props } = flow({ quotaReached: true });
    expect(screen.getByRole('status').textContent).toContain('Limit erstellter Einträge');
    const items = screen.getAllByTestId<HTMLButtonElement>('create-pill');
    expect(items.every((b) => b.disabled && b.getAttribute('aria-disabled') === 'true')).toBe(true);
    await fireEvent.click(items[1] as HTMLElement);
    expect(props.onstart).not.toHaveBeenCalled();
  });

  it('no quota: no hint and the pills are enabled', () => {
    flow();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByTestId<HTMLButtonElement>('create-pill').every((b) => !b.disabled)).toBe(true);
  });

  it('English hint', () => {
    flow({ quotaReached: true, locale: 'en' });
    expect(screen.getByRole('status').textContent).toContain('limit of created entries');
  });

  it('tells the host while a pin is placed, and when it is over (the bar hides meanwhile)', async () => {
    const { props } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    expect(props.onplacing).toHaveBeenLastCalledWith(true);
    await fireEvent.click(screen.getByTestId('placement-cancel'));
    expect(props.onplacing).toHaveBeenLastCalledWith(false);
  });

  it('tells the host while an area is drawn too: the first map tap draws, it must not close the slot (WP-707)', async () => {
    const { props } = flow();
    await fireEvent.click(screen.getByText('Veranstaltung'));
    expect(screen.getByTestId('draw-toolbar')).toBeTruthy();
    expect(props.onplacing).toHaveBeenLastCalledWith(true);
    await fireEvent.click(screen.getByTestId('draw-cancel'));
    expect(props.onplacing).toHaveBeenLastCalledWith(false);
  });

  it('a line counts as placing too', async () => {
    const { props } = flow();
    await fireEvent.click(screen.getByText('Hecke'));
    expect(props.onplacing).toHaveBeenLastCalledWith(true);
  });

  it('unmounting during the pin ends the placing state', async () => {
    const { props, unmount } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    unmount();
    expect(props.onplacing).toHaveBeenLastCalledWith(false);
  });

  it('has no axe violations with the quota hint', async () => {
    const { container } = flow({ quotaReached: true, position: 'left' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
