import { describe, expect, it, vi } from 'vitest';
import { handleListCommand } from '../src/cli/config/list.js';
import * as shared from '../src/cli/config/shared.js';
import * as configModule from '../src/config.js';
import type { ServerDefinition } from '../src/config-schema.js';

const localServer: ServerDefinition = {
  name: 'local-one',
  command: { kind: 'http', url: new URL('https://local.example/mcp'), headers: {} },
};

const importServer: ServerDefinition = {
  name: 'import-one',
  command: { kind: 'stdio', command: 'bin', args: [], cwd: '/tmp' },
  source: { kind: 'import', path: '/imports/cursor.json' },
};

describe('config list', () => {
  it('filters by source and outputs json payload', async () => {
    vi.spyOn(configModule, 'loadServerDefinitions').mockResolvedValue([localServer, importServer]);
    vi.spyOn(shared, 'resolveConfigLocations').mockResolvedValue({
      projectPath: '/tmp/config/mcporter.json',
      projectExists: true,
      systemPath: '/home/user/.mcporter/mcporter.json',
      systemExists: false,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleListCommand({ loadOptions: {} } as never, ['--json', '--source', 'import']);

    const jsonLine = logSpy.mock.calls
      .map((call) => call[0])
      .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{'));
    logSpy.mockRestore();
    expect(jsonLine).toBeDefined();
    const payload = JSON.parse(String(jsonLine));
    expect(payload.servers).toHaveLength(1);
    expect(payload.servers[0].name).toBe('import-one');
  });

  it('shows only local servers when source=local', async () => {
    vi.spyOn(configModule, 'loadServerDefinitions').mockResolvedValue([localServer, importServer]);
    vi.spyOn(shared, 'resolveConfigLocations').mockResolvedValue({
      projectPath: '/tmp/config/mcporter.json',
      projectExists: true,
      systemPath: '/home/user/.mcporter/mcporter.json',
      systemExists: false,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleListCommand({ loadOptions: {} } as never, ['--json', '--source', 'local']);

    const jsonLine = logSpy.mock.calls
      .map((call) => call[0])
      .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{'));
    logSpy.mockRestore();
    expect(jsonLine).toBeDefined();
    const payload = JSON.parse(String(jsonLine));
    expect(payload.servers).toHaveLength(1);
    expect(payload.servers[0].name).toBe('local-one');
  });
});
