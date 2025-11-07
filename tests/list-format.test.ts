import { describe, expect, it } from 'vitest';

import { classifyListError } from '../src/cli/list-format.js';

describe('classifyListError', () => {
  it('respects custom auth command hints', () => {
    const result = classifyListError(new Error('SSE error: Non-200 status code (401)'), 'adhoc-server', 30, {
      authCommand: 'mcporter auth https://example.com/mcp',
    });
    expect(result.category).toBe('auth');
    expect(result.authCommand).toBe('mcporter auth https://example.com/mcp');
    expect(result.colored).toContain('mcporter auth https://example.com/mcp');
  });

  it('classifies transport errors as offline', () => {
    const result = classifyListError(new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:3000'), 'local', 30);
    expect(result.category).toBe('offline');
    expect(result.summary).toBe('offline');
  });

  it('classifies HTTP errors separately', () => {
    const result = classifyListError(new Error('HTTP error 500: upstream unavailable'), 'remote', 30);
    expect(result.category).toBe('http');
    expect(result.summary).toContain('http 500');
  });
});
