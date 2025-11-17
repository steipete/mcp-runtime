import { describe, expect, it } from 'vitest';
import { evaluateStdioLogPolicy, type StdioLogMode } from '../src/sdk-patches.js';

function evaluate(mode: StdioLogMode, hasStderr: boolean, exitCode: number | null) {
  return evaluateStdioLogPolicy(mode, hasStderr, exitCode);
}

describe('sdk-patches STDIO log policy', () => {
  it('prints logs in auto mode only when stderr exists and exit code is non-zero', () => {
    expect(evaluate('auto', true, 1)).toBe(true);
    expect(evaluate('auto', true, 0)).toBe(false);
    expect(evaluate('auto', false, 1)).toBe(false);
  });

  it('always prints when mode is forced to always', () => {
    expect(evaluate('always', true, 0)).toBe(true);
    expect(evaluate('always', true, null)).toBe(true);
  });

  it('never prints when mode is silent', () => {
    expect(evaluate('silent', true, 2)).toBe(false);
    expect(evaluate('silent', true, null)).toBe(false);
  });
});
