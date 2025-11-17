import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImportCommand } from '../src/cli/config/import.js';
import type { LoadConfigOptions, RawConfig } from '../src/config.js';
import * as configModule from '../src/config.js';
import * as importModule from '../src/config-imports.js';

let tempDir: string;
let loadOptions: LoadConfigOptions;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-import-'));
  loadOptions = { rootDir: tempDir };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('config import', () => {
  it('copies filtered entries into project config', async () => {
    vi.spyOn(importModule, 'pathsForImport').mockReturnValue([path.join(tempDir, 'imports', 'cursor.json')]);
    vi.spyOn(importModule, 'readExternalEntries').mockResolvedValue(
      new Map([
        ['keep', { baseUrl: 'https://example.com/mcp' }],
        ['skip', { baseUrl: 'https://skip.example/mcp' }],
      ]) as never
    );

    let writtenConfig: RawConfig | undefined;
    vi.spyOn(configModule, 'writeRawConfig').mockImplementation(async (_path, config) => {
      writtenConfig = config as RawConfig;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleImportCommand({ loadOptions } as never, ['cursor', '--copy', '--filter', 'keep']);
    logSpy.mockRestore();

    expect(writtenConfig?.mcpServers?.keep).toBeDefined();
    expect(writtenConfig?.mcpServers?.skip).toBeUndefined();
  });

  it('emits JSON when --json is provided', async () => {
    vi.spyOn(importModule, 'pathsForImport').mockReturnValue([path.join(tempDir, 'imports', 'cursor.json')]);
    vi.spyOn(importModule, 'readExternalEntries').mockResolvedValue(
      new Map([['keep', { baseUrl: 'https://example.com/mcp' }]]) as never
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleImportCommand({ loadOptions } as never, ['cursor', '--json']);

    const json = logSpy.mock.calls
      .map((call) => call[0])
      .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{'));
    logSpy.mockRestore();
    expect(json).toBeDefined();
    const payload = JSON.parse(String(json)) as { entries: Array<{ name: string }> };
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]?.name).toBe('keep');
  });
});
