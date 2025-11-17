import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDoctorCommand } from '../src/cli/config/doctor.js';
import type { LoadConfigOptions } from '../src/config.js';
import * as configModule from '../src/config.js';

let tempDir: string;
let loadOptions: LoadConfigOptions;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-doctor-'));
  loadOptions = { rootDir: tempDir };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('config doctor', () => {
  it('reports issues for stdio cwd and missing oauth token cache', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(configModule, 'loadServerDefinitions').mockResolvedValue([
      {
        name: 'bad-stdio',
        command: { kind: 'stdio', command: 'node', args: [], cwd: 'relative/path' },
      },
      {
        name: 'oauth-missing-cache',
        command: { kind: 'http', url: new URL('https://example.com/mcp'), headers: {} },
        auth: 'oauth',
        tokenCacheDir: undefined,
      },
    ]);

    await handleDoctorCommand({ loadOptions } as never, []);

    const output = logSpy.mock.calls.flat().join('\n');
    logSpy.mockRestore();

    expect(output).toContain('has a non-absolute working directory');
    expect(output).toContain('enables OAuth but lacks a token cache directory');
  });
});
