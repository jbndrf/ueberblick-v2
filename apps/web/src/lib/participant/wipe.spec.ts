// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { deviceName, draftBlobsName, draftScope, thumbsName } from './device-names';
import { wipeParticipantDevice } from './wipe';

const who = { project: 'demo', participant: 'vera' };

async function create(factory: IDBFactory, name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(new Error('open'));
  });
}

describe('wipeParticipantDevice (WP-769: v3 resetAllParticipantState)', () => {
  it('deletes the participant databases and keys, and leaves another participant and the device settings alone', async () => {
    const factory = new IDBFactory();
    const mine = [
      deviceName('demo', 'vera'),
      `${deviceName('demo', 'vera')}-tooldata`,
      thumbsName('demo', 'vera'),
      draftBlobsName('demo', 'vera'),
    ];
    const others = [deviceName('demo', 'jonas'), thumbsName('demo', 'jonas')];
    for (const n of [...mine, ...others]) await create(factory, n);
    const keep = [
      'ub:locale',
      'ub:font-size',
      `ub:init:${deviceName('demo', 'jonas')}`,
      'ub:draft:demo:jonas:t',
    ];
    const gone = [
      `ub:init:${deviceName('demo', 'vera')}`,
      `ub:draft:${draftScope('demo', 'vera')}:task-1`,
      'ueberblick.prefs.demo.vera',
    ];
    const storage = localStorage;
    for (const k of [...keep, ...gone]) storage.setItem(k, '1');

    await wipeParticipantDevice(who, { idb: factory, storage });

    const left = (await factory.databases()).map((d) => d.name);
    expect(left.sort()).toEqual([...others].sort());
    expect(Object.keys(storage).sort()).toEqual([...keep].sort());
  });

  it('a database that is blocked by another tab does not hold the sign-out for ever', async () => {
    const stuck = {
      deleteDatabase: () => {
        const req: { onblocked?: () => void; onsuccess?: () => void; onerror?: () => void } = {};
        queueMicrotask(() => req.onblocked?.());
        return req;
      },
    };
    await expect(
      wipeParticipantDevice(who, { idb: stuck as never, storage: localStorage, blockedMs: 5 }),
    ).resolves.toBeUndefined();
  });

  it('removes the offline map packs of the participant (WP-782)', async () => {
    const scopes: unknown[] = [];
    await wipeParticipantDevice(who, {
      idb: new IDBFactory(),
      storage: localStorage,
      clearPacks: async (s) => void scopes.push(s),
    });
    expect(scopes).toEqual([{ project: 'demo', participant: 'vera' }]);
  });

  it('a pack removal error is logged and does not stop the wipe (WP-782)', async () => {
    const factory = new IDBFactory();
    await create(factory, deviceName('demo', 'vera'));
    localStorage.setItem('ueberblick.prefs.demo.vera', '1');
    const warned: string[] = [];
    await expect(
      wipeParticipantDevice(who, {
        idb: factory,
        storage: localStorage,
        clearPacks: async () => {
          throw new Error('opfs');
        },
        warn: (m) => void warned.push(m),
      }),
    ).resolves.toBeUndefined();
    expect(warned).toHaveLength(1);
    expect((await factory.databases()).length).toBe(0);
    expect(localStorage.getItem('ueberblick.prefs.demo.vera')).toBeNull();
  });
});
