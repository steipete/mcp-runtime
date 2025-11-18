import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRemoveCommand } from '../src/cli/config/remove.js';
import type { LoadConfigOptions, RawConfig } from '../src/config.js';
import { createTempConfig } from './fixtures/config-fixture.js';

describe('config remove', () => {
  let loadOptions: LoadConfigOptions;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const initial: RawConfig = {
      mcpServers: {
        linear: { baseUrl: 'https://linear.app/mcp' },
        alpha: { baseUrl: 'https://alpha.example/mcp' },
      },
      imports: [],
    };
    const ctx = await createTempConfig(initial);
    loadOptions = ctx.loadOptions;
    cleanup = () => ctx.cleanup();
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
    vi.restoreAllMocks();
  });

  it('fuzzy-matches server names when removing entries', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleRemoveCommand({ loadOptions } as never, ['linr']);

    const buffer = await fs.readFile(loadOptions.configPath ?? '', 'utf8');
    const parsed = JSON.parse(buffer) as RawConfig;
    logSpy.mockRestore();

    expect(parsed.mcpServers?.linear).toBeUndefined();
    expect(parsed.mcpServers?.alpha).toBeDefined();
  });
});
