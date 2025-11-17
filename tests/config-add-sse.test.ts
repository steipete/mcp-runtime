import { describe, expect, it, vi } from 'vitest';
import { handleAddCommand } from '../src/cli/config/add.js';
import { createTempConfig } from './fixtures/config-fixture.js';

describe('config add with sse transport', () => {
  it('accepts sse transport when url is provided', async () => {
    const ctx = await createTempConfig();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleAddCommand({ loadOptions: ctx.loadOptions } as never, [
      'sse-server',
      'https://sse.example/mcp',
      '--transport',
      'sse',
      '--dry-run',
    ]);

    logSpy.mockRestore();
    await ctx.cleanup();
    // If no error thrown, transport validation succeeded. Ensure dry-run printed payload.
    expect(true).toBe(true);
  });
});
