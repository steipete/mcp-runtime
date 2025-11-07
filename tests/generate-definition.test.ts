import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveServerDefinition } from '../src/cli/generate/definition.js';

const FIXTURE_CONFIG = path.resolve(__dirname, 'fixtures', 'mcporter.json');

describe('resolveServerDefinition HTTP selectors', () => {
  it('resolves configured servers by HTTPS URL', async () => {
    const { name } = await resolveServerDefinition('https://www.shadcn.io/api/mcp', FIXTURE_CONFIG);
    expect(name).toBe('shadcn');
  });

  it('resolves configured servers by scheme-less selectors with tool suffixes', async () => {
    const { name } = await resolveServerDefinition('shadcn.io/api/mcp.getComponent', FIXTURE_CONFIG);
    expect(name).toBe('shadcn');
  });

  it('treats raw HTTPS paths without scheme as stdio commands in inline definitions', async () => {
    const inline = JSON.stringify({ name: 'context7-inline', command: 'mcp.context7.com/mcp' });
    const { definition, name } = await resolveServerDefinition(inline);
    expect(name).toBe('context7-inline');
    expect(definition.command.kind).toBe('stdio');
    expect((definition.command as { command: string }).command).toBe('mcp.context7.com/mcp');
  });
});
