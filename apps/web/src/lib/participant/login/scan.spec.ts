import { describe, expect, it } from 'vitest';
import { tokenFromScan, tokenFromLocation } from './scan';

const ORIGIN = 'https://ueb.example';

describe('tokenFromScan', () => {
  it('a raw token is the token (trimmed)', () => {
    expect(tokenFromScan('  abc123  ', ORIGIN)).toEqual({ kind: 'token', token: 'abc123' });
  });
  it('a login link of the own origin with ?token= gives the token', () => {
    expect(tokenFromScan(`${ORIGIN}/login?token=abc%20123`, ORIGIN)).toEqual({
      kind: 'token',
      token: 'abc 123',
    });
  });
  it('a link from another origin is an invalid code, with or without a token', () => {
    expect(tokenFromScan('https://elsewhere.example/login?token=abc123', ORIGIN)).toEqual({
      kind: 'invalid',
    });
    expect(tokenFromScan('https://elsewhere.example/elsewhere', ORIGIN)).toEqual({ kind: 'invalid' });
  });
  it('a link of the own origin without a token, or an empty scan, gives nothing', () => {
    expect(tokenFromScan(`${ORIGIN}/login`, ORIGIN)).toBeUndefined();
    expect(tokenFromScan('   ', ORIGIN)).toBeUndefined();
  });
});

describe('tokenFromLocation', () => {
  it('reads ?token= only', () => {
    expect(tokenFromLocation('?token=q')).toBe('q');
    expect(tokenFromLocation('?x=1')).toBeUndefined();
    expect(tokenFromLocation('?token=')).toBeUndefined();
  });
});
