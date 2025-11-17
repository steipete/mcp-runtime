import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAddCommand } from '../src/cli/config/add.js';
import type { LoadConfigOptions } from '../src/config.js';

describe('config add --dry-run', () => {
  let tempDir: string;
  let loadOptions: LoadConfigOptions;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-add-'));
    loadOptions = { rootDir: tempDir };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('prints entry without writing config when dry-run is set', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleAddCommand({ loadOptions } as never, [
      'linear',
      'https://linear.app/mcp',
      '--description',
      'test',
      '--dry-run',
    ]);

    const outputs = logSpy.mock.calls.map((call) => call[0]).join('\n');
    logSpy.mockRestore();

    const configPath = path.join(tempDir, 'config', 'mcporter.json');
    const exists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
    expect(outputs).toContain('(dry-run) No changes were written.');
    expect(outputs).toContain('"linear"');
  });
});
