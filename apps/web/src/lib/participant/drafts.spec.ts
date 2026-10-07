import { describe, expect, it } from 'vitest';
import { createDraftStore, type StoragePort } from './drafts';

function memory(): StoragePort & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('draft store', () => {
  it('keeps one draft per key and drops it', async () => {
    const s = createDraftStore(memory(), 'demo:anna');
    expect(await s.get('kontrolle:f1')).toBeUndefined();
    await s.put('kontrolle:f1', { befund: 'Riss' });
    expect(await s.get('kontrolle:f1')).toEqual({ befund: 'Riss' });
    await s.drop('kontrolle:f1');
    expect(await s.get('kontrolle:f1')).toBeUndefined();
  });

  it("two participants of one device never see each other's drafts", async () => {
    const shared = memory();
    await createDraftStore(shared, 'demo:anna').put('k', { a: 1 });
    expect(await createDraftStore(shared, 'demo:ben').get('k')).toBeUndefined();
  });

  it('a damaged draft is dropped, not shown; a failed write rejects', async () => {
    const m = memory();
    const s = createDraftStore(m, 'demo:anna');
    m.data.set('ub:draft:demo:anna:k', '{not json');
    expect(await s.get('k')).toBeUndefined();
    expect(m.data.size).toBe(0);
    m.setItem = () => {
      throw new Error('quota');
    };
    await expect(s.put('k', {})).rejects.toThrow('quota');
  });
});

describe('draft store with photo bytes (WP-811)', () => {
  const sha = 'b'.repeat(64);
  const values = { foto: { sha256: sha } };
  function fake() {
    const calls: string[] = [];
    return {
      calls,
      blobs: {
        persist: async () => void calls.push('persist'),
        restore: async () => (calls.push('restore'), [] as readonly string[]),
        forget: async () => void calls.push('forget'),
        sweep: async () => void calls.push('sweep'),
      },
    };
  }

  it('put persists before the draft is written; get restores; drop forgets', async () => {
    const m = memory();
    const f = fake();
    const s = createDraftStore(m, 'demo:anna', f.blobs);
    await s.put('k', values);
    expect(await s.get('k')).toEqual(values);
    await s.drop('k');
    expect(f.calls).toEqual(['sweep', 'persist', 'restore', 'forget']);
    expect(m.data.size).toBe(0);
  });

  it('a draft whose bytes cannot be kept is not claimed', async () => {
    const m = memory();
    const s = createDraftStore(m, 'demo:anna', {
      ...fake().blobs,
      persist: async () => {
        throw new Error('quota');
      },
    });
    await expect(s.put('k', values)).rejects.toThrow('quota');
    expect(m.data.size).toBe(0);
  });

  it('a photo whose bytes cannot be restored is removed from the restored draft, not shown as present', async () => {
    const m = memory();
    const other = 'c'.repeat(64);
    const s = createDraftStore(m, 'demo:anna', {
      ...fake().blobs,
      restore: async () => [sha],
    });
    await s.put('k', { foto: { sha256: sha }, fotos: [{ sha256: sha }, { sha256: other }], note: 'x' });
    expect(await s.get('k')).toEqual({ fotos: [{ sha256: other }], note: 'x' });
  });

  it('a shelf that cannot be read removes every photo from the restored draft', async () => {
    const s = createDraftStore(memory(), 'demo:anna', {
      ...fake().blobs,
      restore: async () => {
        throw new Error('idb closed');
      },
    });
    await s.put('k', { foto: { sha256: sha }, note: 'x' });
    expect(await s.get('k')).toEqual({ note: 'x' });
  });

  it('a new version of a draft removes the shelf rows of photos it no longer has', async () => {
    const other = 'c'.repeat(64);
    const forgotten: string[] = [];
    const f = fake();
    const s = createDraftStore(memory(), 'demo:anna', {
      ...f.blobs,
      forget: async (_k, v) => void forgotten.push(...(JSON.stringify(v).match(/[0-9a-f]{64}/g) ?? [])),
    });
    await s.put('k', { a: { sha256: sha }, b: { sha256: other } });
    expect(forgotten).toEqual([]);
    await s.put('k', { b: { sha256: other } });
    expect(forgotten).toEqual([sha]);
  });
});

describe('draft store sweeps leftover shelf rows (WP-813)', () => {
  it('a failed forget leaves a row that the next open sweeps; live drafts stay', async () => {
    const m = memory();
    const rows = new Map<string, Set<string>>();
    const sha = 'd'.repeat(64);
    let failForget = true;
    const blobs = {
      persist: async (k: string) => void rows.set(k, new Set([sha])),
      restore: async () => [] as readonly string[],
      forget: async (k: string) => {
        if (failForget) throw new Error('idb');
        rows.delete(k);
      },
      sweep: async (isLive: (k: string) => boolean) => {
        for (const k of [...rows.keys()]) if (!isLive(k)) rows.delete(k);
      },
    };
    const first = createDraftStore(m, 'demo:anna', blobs);
    await first.put('gone', { f: { sha256: sha } });
    await first.put('live', { f: { sha256: sha } });
    await first.drop('gone');
    expect([...rows.keys()].sort()).toEqual(['gone', 'live']);
    failForget = false;
    await createDraftStore(m, 'demo:anna', blobs).get('live'); // next open
    expect([...rows.keys()]).toEqual(['live']);
  });
});
