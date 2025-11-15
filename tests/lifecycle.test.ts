import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../src/config-schema.js';
import { resolveLifecycle } from '../src/lifecycle.js';

const CHROME_COMMAND: CommandSpec = {
  kind: 'stdio',
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', String.raw`\${CHROME_DEVTOOLS_URL}`],
  cwd: process.cwd(),
};

const CHROME_COMMAND_ENV: CommandSpec = {
  kind: 'stdio',
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', '$env:CHROME_DEVTOOLS_URL'],
  cwd: process.cwd(),
};

describe('resolveLifecycle', () => {
  it('forces chrome-devtools placeholder runs to be ephemeral', () => {
    const lifecycle = resolveLifecycle('chrome-devtools', undefined, CHROME_COMMAND);
    expect(lifecycle?.mode).toBe('ephemeral');
  });

  it('forces chrome-devtools $env placeholder runs to be ephemeral', () => {
    const lifecycle = resolveLifecycle('chrome-devtools', undefined, CHROME_COMMAND_ENV);
    expect(lifecycle?.mode).toBe('ephemeral');
  });
});
