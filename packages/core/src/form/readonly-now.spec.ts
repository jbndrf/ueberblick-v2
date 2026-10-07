// WP-1066: a readonly calculate that reads `now` differs between device and server by design; it is not a write.
import { describe, expect, it } from 'vitest';
import type { Key } from '../model';
import { formApi } from './index';
import { FILE, ctx, world } from './__fixtures__';

const config = world({
  ...FILE,
  tasks: {
    ...FILE.tasks,
    frist: {
      label: { de: 'Frist' },
      on: 'baum',
      form: { befund: { readonly: true, calculate: "now == now ? 'neu' : ''" } },
    },
  },
});

describe('readonly calculate that reads now', () => {
  it('accepts the device value and submits the recomputed one', () => {
    const ev = formApi.evaluate('frist' as Key, config, { befund: 'von-gestern' }, ctx(config));
    expect(ev.valid).toBe(true);
    expect(formApi.submitValues(ev)).toMatchObject({ befund: 'neu' });
  });
});
