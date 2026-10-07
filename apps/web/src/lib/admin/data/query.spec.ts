import { describe, expect, it } from 'vitest';
import { distinctUrl, listUrl, PAGE_SIZE } from './query';
import type { TableQuery } from '@ueberblick/ui/components/admin';

const q = (over: Partial<TableQuery> = {}): TableQuery => ({
  search: '',
  sort: null,
  filters: {},
  page: 0,
  ...over,
});
const params = (url: string) => new URL(url, 'http://x').searchParams;

describe('list url', () => {
  it('asks for the type and one page of 200 (v3 page size)', () => {
    const p = params(listUrl('musterstadt', 'baum', q(), null));
    expect(listUrl('musterstadt', 'baum', q(), null)).toMatch(/^\/api\/admin\/p\/musterstadt\/features\?/);
    expect(p.get('type')).toBe('baum');
    expect(p.get('limit')).toBe(String(PAGE_SIZE));
    expect(PAGE_SIZE).toBe(200);
    expect(p.has('q')).toBe(false);
    expect(p.has('lifecycle')).toBe(false); // the API hides deleted by default
    expect(p.has('cursor')).toBe(false);
  });

  it('sends search, sort, filters and the cursor', () => {
    const p = params(
      listUrl(
        'p',
        'baum',
        q({
          search: 'Ast',
          sort: { key: '$created_at', direction: 'desc' },
          filters: { stage: ['a', 'b,c'], befund: ['__empty__'] },
        }),
        'CUR',
      ),
    );
    expect(p.get('q')).toBe('Ast');
    expect(p.get('sort')).toBe('$created_at');
    expect(p.get('dir')).toBe('desc');
    expect(p.get('filter.stage')).toBe('a,b\\,c');
    expect(p.get('filter.befund')).toBe('__empty__');
    expect(p.get('cursor')).toBe('CUR');
  });

  it('a status filter lists every state, so "gelöscht" can be picked', () => {
    const p = params(listUrl('p', 'baum', q({ filters: { $lifecycle: ['deleted'] } }), null));
    expect(p.get('lifecycle')).toBe('active,completed,archived,deleted');
  });

  it('leaves out an empty filter', () => {
    expect(params(listUrl('p', 'baum', q({ filters: { stage: [] } }), null)).has('filter.stage')).toBe(false);
  });
});

describe('distinct url', () => {
  it('names the column and carries the other filters', () => {
    const p = params(distinctUrl('p', 'baum', 'stage', q({ search: 'x', filters: { befund: ['a'] } })));
    expect(distinctUrl('p', 'baum', 'stage', q())).toMatch(/\/features\/distinct\?/);
    expect(p.get('column')).toBe('stage');
    expect(p.get('q')).toBe('x');
    expect(p.get('filter.befund')).toBe('a');
    expect(p.has('limit')).toBe(false);
    expect(p.has('sort')).toBe(false);
  });

  it('leaves out the own filter of the column', () => {
    const p = params(distinctUrl('p', 'baum', 'stage', q({ filters: { stage: ['a'] } })));
    expect(p.has('filter.stage')).toBe(false);
  });

  it('counts every state for the status column', () => {
    expect(params(distinctUrl('p', 'baum', '$lifecycle', q())).get('lifecycle')).toBe(
      'active,completed,archived,deleted',
    );
  });
});
