import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleAddCommand } from '../src/cli/config/add.js';
import { createTempConfig } from './fixtures/config-fixture.js';

describe('config add persist and scope', () => {
  it('writes to custom persist path when provided', async () => {
    const ctx = await createTempConfig();
    const persistPath = path.join(ctx.tempDir, 'custom', 'mcporter.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleAddCommand({ loadOptions: ctx.loadOptions } as never, [
      'persisted',
      'https://persist.example/mcp',
      '--persist',
      persistPath,
    ]);

    logSpy.mockRestore();
    const buffer = await fs.readFile(persistPath, 'utf8');
    const parsed = JSON.parse(buffer) as { mcpServers: Record<string, { baseUrl: string }> };
    expect(parsed.mcpServers.persisted).toBeDefined();
    expect(parsed.mcpServers.persisted?.baseUrl).toBe('https://persist.example/mcp');
    await ctx.cleanup();
  });
});
