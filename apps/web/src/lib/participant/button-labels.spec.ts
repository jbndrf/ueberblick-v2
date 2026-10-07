import { describe, expect, it } from 'vitest';
import { message } from './messages';

/**
 * WP-727 (QA hunt 3). v3 names the layers and location buttons twice, and so does v4, on purpose: the phone bar carries a short
 * label under its icon (`participantBottomControlBarLayers` "Layer", `...Location` "Standort",
 * reference/messages/de.json:1629-1630) and the header button's title is the long name (`mapFilterLayers` "Kartenebenen",
 * `mapMyLocation` "Mein Standort", +layout.svelte:572,604; the bar's own title is `mapMyLocation` too, BottomControlBar.svelte:104).
 * One message key per button and place.
 */
describe('layers and location buttons carry v3 labels', () => {
  it('phone bar: the short labels', () => {
    expect(message('de', 'bar_layers')).toBe('Layer');
    expect(message('de', 'bar_location')).toBe('Standort');
  });
  it('header: the long names, and the layer sheet title', () => {
    expect(message('de', 'header_layers')).toBe('Kartenebenen');
    expect(message('de', 'header_location')).toBe('Mein Standort');
    expect(message('de', 'layer_title')).toBe('Kartenlayer');
  });
});

describe('the pending notice reads as sentences', () => {
  for (const locale of ['de', 'en'] as const) {
    it(`${locale}: the count sentence and the retry sentence each end with a full stop`, () => {
      const pending = message(locale, 'run_pending_notice', { count: 1 });
      const retry = message(locale, 'run_retry_notice');
      expect(pending).toMatch(/1\.$/);
      expect(retry).toMatch(/\.$/);
      expect(`${pending} ${retry}`).toMatch(/1\. [A-ZÄÖÜ]/);
    });
  }
});
