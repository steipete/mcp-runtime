import { describe, expect, it, vi } from 'vitest';
import { handleGetCommand } from '../src/cli/config/get.js';
import * as configModule from '../src/config.js';
import type { ServerDefinition } from '../src/config-schema.js';

describe('config get --json', () => {
  it('includes headers and env in JSON output', async () => {
    const server: ServerDefinition = {
      name: 'http-one',
      command: { kind: 'http', url: new URL('https://api.example/mcp'), headers: { Authorization: 'Bearer token' } },
      env: { FOO: 'bar' },
    };
    vi.spyOn(configModule, 'loadServerDefinitions').mockResolvedValue([server]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleGetCommand({ loadOptions: {} } as never, ['http-one', '--json']);

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    logSpy.mockRestore();
    const payload = JSON.parse(output) as { headers?: Record<string, string>; env?: Record<string, string> };
    expect(payload.headers?.Authorization).toBe('Bearer token');
    expect(payload.env?.FOO).toBe('bar');
  });
});
