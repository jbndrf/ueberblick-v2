import { describe, expect, it } from 'vitest';
import { quietOfflineLog } from './sync-log';

const offline = (): TypeError => new TypeError('Failed to fetch');

describe('quietOfflineLog (WP-731)', () => {
  it('logs the first network failure of an offline period and none after it', () => {
    const lines: string[] = [];
    const log = quietOfflineLog((where) => lines.push(where));
    for (let i = 0; i < 50; i++) log.report('sync:open', offline());
    log.report('sync:online', offline());
    log.report('queue:retry', offline());
    expect(lines).toEqual(['sync:open']);
  });

  it('logs again in the next offline period', () => {
    const lines: string[] = [];
    const log = quietOfflineLog((where) => lines.push(where));
    log.report('sync:open', offline());
    log.backOnline();
    log.report('sync:visible', offline());
    expect(lines).toEqual(['sync:open', 'sync:visible']);
  });

  it('logs every other error each time', () => {
    const lines: string[] = [];
    const log = quietOfflineLog((where) => lines.push(where));
    log.report('submit', new Error('disk full'));
    log.report('submit', new Error('disk full'));
    expect(lines).toEqual(['submit', 'submit']);
  });
});
