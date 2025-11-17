import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { handleImportCommand } from '../src/cli/config/import.js';
import * as importModule from '../src/config-imports.js';
import { createTempConfig } from './fixtures/config-fixture.js';

describe('config import deduplication', () => {
  it('keeps first matching entry when multiple imports share names', async () => {
    const ctx = await createTempConfig();
    const firstPath = '/first.json';
    const secondPath = '/second.json';
    vi.spyOn(importModule, 'pathsForImport').mockReturnValue([firstPath, secondPath]);
    vi.spyOn(importModule, 'readExternalEntries')
      .mockResolvedValueOnce(new Map([['dup', { baseUrl: 'https://first.example/mcp' }]]) as never)
      .mockResolvedValueOnce(new Map([['dup', { baseUrl: 'https://second.example/mcp' }]]) as never);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleImportCommand({ loadOptions: ctx.loadOptions } as never, ['cursor', '--copy']);
    logSpy.mockRestore();

    const buffer = await fs.readFile(ctx.loadOptions.configPath ?? '', 'utf8');
    const parsed = JSON.parse(buffer) as { mcpServers: Record<string, { baseUrl: string }> };
    expect(parsed.mcpServers.dup).toBeDefined();
    expect(parsed.mcpServers.dup?.baseUrl).toBe('https://first.example/mcp');
    await ctx.cleanup();
  });
});
