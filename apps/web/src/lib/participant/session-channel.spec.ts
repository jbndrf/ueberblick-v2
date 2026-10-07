import { describe, expect, it } from 'vitest';
import { announceSessionChanged, listenSessionChanged } from './session-channel';

describe('session-changed channel (WP-768)', () => {
  it('another listener of the browser hears an announcement; stopping ends it', async () => {
    const heard: number[] = [];
    const stop = listenSessionChanged(() => heard.push(1));
    announceSessionChanged();
    await new Promise((r) => setTimeout(r, 30));
    expect(heard).toEqual([1]);
    stop();
    announceSessionChanged();
    await new Promise((r) => setTimeout(r, 30));
    expect(heard).toEqual([1]);
  });

  it('a sender that excludes its own document is not heard there (the sign-in page and the map are one document)', async () => {
    const heard: number[] = [];
    const stop = listenSessionChanged(() => heard.push(1));
    announceSessionChanged(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(heard).toEqual([]);
    stop();
  });
});
