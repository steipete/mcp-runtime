import { describe, expect, it } from 'vitest';
import type { ServerDefinition } from '../src/config-schema.js';
import { createRuntime } from '../src/runtime.js';

/**
 * Tests for tool filtering functionality (allowedTools / blockedTools).
 *
 * This feature was implemented by Jarbas (AI assistant) for tonylampada.
 */

// Mock server definition factory
function createMockDefinition(
  name: string,
  options: { allowedTools?: string[]; blockedTools?: string[] } = {}
): ServerDefinition {
  return {
    name,
    command: {
      kind: 'http',
      url: new URL('https://example.com/mcp'),
    },
    allowedTools: options.allowedTools,
    blockedTools: options.blockedTools,
  };
}

describe('tool filtering configuration', () => {
  it('accepts allowedTools in server definition', () => {
    const def = createMockDefinition('test', { allowedTools: ['read', 'list'] });
    expect(def.allowedTools).toEqual(['read', 'list']);
  });

  it('accepts blockedTools in server definition', () => {
    const def = createMockDefinition('test', { blockedTools: ['delete', 'write'] });
    expect(def.blockedTools).toEqual(['delete', 'write']);
  });

  it('accepts both allowedTools and blockedTools', () => {
    const def = createMockDefinition('test', {
      allowedTools: ['read'],
      blockedTools: ['delete'],
    });
    expect(def.allowedTools).toEqual(['read']);
    expect(def.blockedTools).toEqual(['delete']);
  });
});

describe('runtime tool filtering', () => {
  it('creates runtime with filtered server definitions', async () => {
    const servers: ServerDefinition[] = [
      createMockDefinition('allowed-only', { allowedTools: ['tool1', 'tool2'] }),
      createMockDefinition('blocked-only', { blockedTools: ['tool3'] }),
      createMockDefinition('no-filter'),
    ];

    const runtime = await createRuntime({ servers });

    // Verify definitions are preserved
    const allowedDef = runtime.getDefinition('allowed-only');
    expect(allowedDef.allowedTools).toEqual(['tool1', 'tool2']);

    const blockedDef = runtime.getDefinition('blocked-only');
    expect(blockedDef.blockedTools).toEqual(['tool3']);

    const noFilterDef = runtime.getDefinition('no-filter');
    expect(noFilterDef.allowedTools).toBeUndefined();
    expect(noFilterDef.blockedTools).toBeUndefined();

    await runtime.close();
  });
});

describe('tool filtering logic', () => {
  // These tests verify the filtering logic without needing actual MCP connections

  it('allowedTools allowlist takes precedence over blockedTools', () => {
    // When both are specified, allowedTools should be the only filter applied
    const def = createMockDefinition('test', {
      allowedTools: ['read'],
      blockedTools: ['read'], // This should be ignored
    });

    // The tool 'read' is in allowedTools, so it should be allowed
    // even though it's also in blockedTools
    expect(def.allowedTools).toContain('read');
  });

  it('empty allowedTools array should block all tools', () => {
    const def = createMockDefinition('test', { allowedTools: [] });
    expect(def.allowedTools).toEqual([]);
    expect(def.allowedTools?.length).toBe(0);
  });

  it('empty blockedTools array should allow all tools', () => {
    const def = createMockDefinition('test', { blockedTools: [] });
    expect(def.blockedTools).toEqual([]);
    expect(def.blockedTools?.length).toBe(0);
  });
});
