import { describe, expect, it, vi } from 'vitest';
import { handleListCommand } from '../src/cli/config/list.js';
import * as shared from '../src/cli/config/shared.js';
import * as configModule from '../src/config.js';
import type { ServerDefinition } from '../src/config-schema.js';

describe('config list text footer and import summary', () => {
  it('prints footer paths and import summary when no local matches', async () => {
    const importServer: ServerDefinition = {
      name: 'imported',
      command: { kind: 'http', url: new URL('https://import.example/mcp'), headers: {} },
      source: { kind: 'import', path: '/tmp/import.json' },
    };
    vi.spyOn(configModule, 'loadServerDefinitions').mockResolvedValue([importServer]);
    vi.spyOn(shared, 'resolveConfigLocations').mockResolvedValue({
      projectPath: '/tmp/project/config/mcporter.json',
      projectExists: true,
      systemPath: '/Users/test/.mcporter/mcporter.json',
      systemExists: false,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleListCommand({ loadOptions: {} } as never, []);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    logSpy.mockRestore();

    expect(output).toContain('No local servers match');
    expect(output).toContain('Other sources available via --source import');
    expect(output).toContain('/tmp/project/config/mcporter.json');
    expect(output).toContain('/Users/test/.mcporter/mcporter.json (missing)');
  });
});
