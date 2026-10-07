/**
 * WP-301 acceptance: a 60k-feature v3 export converts, and the fold of the result is what the export says.
 * WP-936: the 60k case is part of the long profile (`npm run sim`, skipped unless `SIM` is set); `npm run check`
 * runs the 6k variant with the same assertions.
 */
import { describe, it } from 'vitest';
import { convertsAndFoldsAsExpected } from './scale.testing';

const SMALL = 6_000;
const LARGE = 60_000;

describe('6k synthetic export', () => {
  it('converts, and the fold equals the expected v4 state', { timeout: 300_000 }, () =>
    convertsAndFoldsAsExpected(SMALL),
  );
});

describe.skipIf(process.env['SIM'] === undefined)('60k synthetic export (long profile)', () => {
  it('converts, and the fold equals the expected v4 state', { timeout: 900_000 }, () =>
    convertsAndFoldsAsExpected(LARGE),
  );
});
