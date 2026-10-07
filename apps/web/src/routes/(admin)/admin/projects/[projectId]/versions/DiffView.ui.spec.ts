// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { Plan } from '@ueberblick/builder';
import DiffView from './DiffView.svelte';

afterEach(cleanup);

const entry = {
  path: 'types.baum.properties',
  change: 'order_changed' as const,
  breaking: false,
  before: ['art', 'vitalitaet'],
  after: ['vitalitaet', 'art'],
};
const plan: Plan = {
  entries: [entry],
  entities: [{ section: 'types', entity: 'baum', path: 'types.baum', changes: [entry] }],
  affected: [],
  breaking: [],
  mappings: [],
};

describe('DiffView: an order change (A-042)', () => {
  it('says "Reihenfolge geändert" in de', () => {
    render(DiffView, { locale: 'de', plan });
    expect(screen.getByText('types.baum.properties')).toBeTruthy();
    expect(screen.getByText('Reihenfolge geändert')).toBeTruthy();
  });
  it('says "order changed" in en', () => {
    render(DiffView, { locale: 'en', plan });
    expect(screen.getByText('order changed')).toBeTruthy();
  });
});
