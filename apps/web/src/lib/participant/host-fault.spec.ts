import { describe, expect, it } from 'vitest';
import { HostProtocolError } from '@ueberblick/client';
import { hostFaultProblem } from './host-fault';
import { problemText } from './notices';

const need = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('expected a problem');
  return v;
};

describe('hostFaultProblem', () => {
  it.each(['bad_version', 'unknown_kind', 'ill_typed'] as const)(
    'a %s fault is a stale page: the text tells the person to reload',
    (code) => {
      const p = hostFaultProblem(new HostProtocolError(code, 'x'));
      expect(p).toMatchObject({ code: 'stale_bundle', subject: 'host', detail: code });
      expect(problemText('de', need(p))).toContain('neu');
      expect(problemText('en', need(p))).toContain('reload');
    },
  );

  it('a diverged replica mends itself and is not news', () => {
    expect(hostFaultProblem(new HostProtocolError('replica_diverged', 'x'))).toBeUndefined();
  });

  it('any other failure of the host says what happened, in both languages', () => {
    const p = hostFaultProblem(new Error('the sync worker crashed: boom'));
    expect(p).toMatchObject({ code: 'sync_host_fault', detail: 'the sync worker crashed: boom' });
    expect(problemText('de', need(p))).toContain('angehalten');
    expect(problemText('de', need(p))).toContain('boom');
    expect(problemText('en', need(p))).toContain('stopped');
  });
});
