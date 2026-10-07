import { describe, expect, it, vi } from 'vitest';
import { APP_PROBLEM_CODES, createProblemLog, problemText } from './notices';

describe('the problem log', () => {
  it('the codes are registry values', () => {
    expect(APP_PROBLEM_CODES.keys).toEqual(
      expect.arrayContaining(['style_unresolved', 'tool_setting_invalid', 'map_unavailable']),
    );
  });

  it('keeps each problem once per code and subject, and tells listeners', () => {
    const log = createProblemLog();
    const seen = vi.fn();
    log.subscribe(seen);
    log.report({ code: 'style_unresolved', subject: 'baeume', detail: 'styles/baum.json' });
    log.report({ code: 'style_unresolved', subject: 'baeume', detail: 'styles/baum.json' });
    log.report({ code: 'tool_setting_invalid', subject: 'search', detail: 'bad source' });
    expect(log.list().map((p) => `${p.code}:${p.subject}`)).toEqual([
      'style_unresolved:baeume',
      'tool_setting_invalid:search',
    ]);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('clear removes the problem of one code and subject', () => {
    const log = createProblemLog();
    log.report({ code: 'map_unavailable', subject: 'karte', detail: 'x' });
    log.clear('map_unavailable', 'karte');
    expect(log.list()).toEqual([]);
  });

  it('says the code and the subject in both languages', () => {
    const p = { code: 'style_unresolved', subject: 'baeume', detail: 'styles/baum.json' } as const;
    expect(problemText('en', p)).toContain('baeume');
    expect(problemText('en', p)).toContain('style_unresolved');
    expect(problemText('de', p)).toContain('baeume');
    expect(problemText('de', { code: 'tool_setting_invalid', subject: 'search', detail: 'd' })).toContain(
      'search',
    );
  });
});
