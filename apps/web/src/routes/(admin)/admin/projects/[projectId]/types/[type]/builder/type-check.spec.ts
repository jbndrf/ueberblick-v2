import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { draftHasType } from './type-check';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(new URL(`../../../../../../../../../../../fixtures/golden/${rel}`, import.meta.url), 'utf8'),
  );

describe('draftHasType', () => {
  const template = golden('templates/baumkataster/1.0.0.yaml');
  const overlay = golden('projects/musterstadt-baeume.yaml');

  it('knows the Objektarten of the draft', () => {
    expect(draftHasType(template, overlay, 'baum')).toBe(true);
    expect(draftHasType(template, overlay, 'flaeche')).toBe(true);
  });

  it('says no to an unknown Objektart (the route answers 404)', () => {
    expect(draftHasType(template, overlay, 'gibtsnicht')).toBe(false);
  });
});
