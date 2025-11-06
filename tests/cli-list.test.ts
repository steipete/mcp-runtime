import { describe, expect, it, vi } from 'vitest';
import type { ServerDefinition } from '../src/config.js';

process.env.MCPORTER_DISABLE_AUTORUN = '1';
const cliModulePromise = import('../src/cli.js');

const stripAnsi = (value: string): string => {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\u001B') {
      index += 1;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
};

const linearDefinition: ServerDefinition = {
  name: 'linear',
  description: 'Hosted Linear MCP',
  command: { kind: 'http', url: new URL('https://example.com/mcp') },
};

const buildLinearDocumentsTool = (includeSchema?: boolean) => ({
  name: 'list_documents',
  description: "List documents in the user's Linear workspace",
  inputSchema: includeSchema
    ? {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Maximum number of documents to return' },
          before: { type: 'string', description: 'Cursor to page backwards' },
          after: { type: 'string', description: 'Cursor to page forwards' },
          orderBy: {
            type: 'string',
            description: 'Sort order for the documents',
            enum: ['createdAt', 'updatedAt'],
          },
          projectId: { type: 'string', description: 'Filter by project' },
          initiativeId: { type: 'string', description: 'Filter by initiative' },
          creatorId: { type: 'string', description: 'Filter by creator' },
          includeArchived: { type: 'boolean', description: 'Whether to include archived documents' },
        },
        required: ['query'],
      }
    : undefined,
  outputSchema: includeSchema
    ? {
        title: 'DocumentConnection',
        type: 'object',
      }
    : undefined,
});

describe('CLI list timeout handling', () => {
  it('parses --timeout flag into list flags', async () => {
    const { extractListFlags } = await cliModulePromise;
    const args = ['--timeout', '7500', '--schema', 'server'];
    const flags = extractListFlags(args);
    expect(flags).toEqual({ schema: true, timeoutMs: 7500, requiredOnly: true, ephemeral: undefined });
    expect(args).toEqual(['server']);
  });

  it('parses --all-parameters flag and removes it from args', async () => {
    const { extractListFlags } = await cliModulePromise;
    const args = ['--all-parameters', 'server'];
    const flags = extractListFlags(args);
    expect(flags).toEqual({ schema: false, timeoutMs: undefined, requiredOnly: false, ephemeral: undefined });
    expect(args).toEqual(['server']);
  });

  it('honors --timeout when listing a single server', async () => {
    const { handleList } = await cliModulePromise;
    const definition: ServerDefinition = {
      name: 'slow-server',
      command: { kind: 'stdio', command: 'noop', args: [], cwd: process.cwd() },
      source: { kind: 'local', path: '/tmp/config.json' },
    };

    const runtime = {
      getDefinitions: () => [definition],
      getDefinition: () => definition,
      listTools: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ name: 'ok' }]), 50);
        }),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleList(runtime, ['--timeout', '10', 'slow-server']);

    const warningLines = warnSpy.mock.calls.map((call) => call[0]);
    expect(warningLines).toContain('  Tools: <timed out after 10ms>');
    expect(warningLines).toContain('  Reason: Timeout');

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('CLI list classification', () => {
  it('identifies auth and offline failures and suggests remediation', async () => {
    const originalCI = process.env.CI;
    process.env.CI = '1';

    const { handleList } = await cliModulePromise;
    const definitions: ServerDefinition[] = [
      {
        name: 'healthy',
        command: { kind: 'stdio', command: 'noop', args: [], cwd: process.cwd() },
        source: { kind: 'local', path: '/tmp/config.json' },
      },
      {
        name: 'vercel',
        description: 'Vercel MCP',
        command: { kind: 'http', url: new URL('https://example.com') },
      },
      {
        name: 'github',
        command: { kind: 'http', url: new URL('https://example.com') },
        source: { kind: 'import', path: '/tmp/import.json' },
      },
      {
        name: 'next-devtools',
        command: { kind: 'http', url: new URL('https://localhost') },
      },
      {
        name: 'obsidian',
        command: { kind: 'http', url: new URL('https://localhost') },
      },
    ];

    const runtime = {
      getDefinitions: () => definitions,
      listTools: (name: string) => {
        switch (name) {
          case 'healthy':
            return Promise.resolve([{ name: 'ok' }]);
          case 'vercel':
            return Promise.reject(new Error('SSE error: Non-200 status code (401)'));
          case 'github':
            return Promise.reject(new Error('SSE error: Non-200 status code (405)'));
          case 'next-devtools':
            return Promise.reject(new Error('SSE error: fetch failed: connect ECONNREFUSED 127.0.0.1:3000'));
          case 'obsidian':
            // Regression guard: raw "connection closed" errors should map to offline for friendlier messaging.
            return Promise.reject(new Error('MCP error -32000: Connection closed'));
          default:
            return Promise.resolve([]);
        }
      },
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleList(runtime, []);

    const logLines = logSpy.mock.calls.map((call) => call.join(' '));
    expect(
      logLines.some((line) => line.includes("vercel — Vercel MCP (auth required — run 'mcporter auth vercel'"))
    ).toBe(true);
    expect(logLines.some((line) => line.includes("github (auth required — run 'mcporter auth github'"))).toBe(true);
    const nextDevtoolsLineFound = logLines.some(
      (line) => line.startsWith('- next-devtools') && line.includes('offline — unable to reach server')
    );
    expect(nextDevtoolsLineFound).toBe(true);
    expect(
      logLines.some((line) => line.includes('obsidian') && line.includes('offline — unable to reach server'))
    ).toBe(true);

    const summaryLine = logLines.find((line) => line.startsWith('✔ Listed'));
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toContain('auth required');
    expect(summaryLine).toContain('offline');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.CI = originalCI;
  });

  it('suggests URL-based auth for ad-hoc HTTP servers', async () => {
    const { handleList } = await cliModulePromise;
    const definitions = new Map<string, ServerDefinition>();
    const runtime = {
      registerDefinition: vi.fn((definition: ServerDefinition) => {
        definitions.set(definition.name, definition);
      }),
      getDefinition: vi.fn((name: string) => {
        const entry = definitions.get(name);
        if (!entry) {
          throw new Error(`Unknown MCP server '${name}'.`);
        }
        return entry;
      }),
      getDefinitions: () => Array.from(definitions.values()),
      listTools: vi.fn().mockRejectedValue(new Error('SSE error: Non-200 status code (401)')),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['https://mcp.supabase.com/mcp']);

    const hinted = warnSpy.mock.calls.some((call) =>
      (call[0]?.toString() ?? '').includes("Next: run 'mcporter auth https://mcp.supabase.com/mcp'")
    );
    expect(hinted).toBe(true);

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('prints detailed usage for single server listings', async () => {
    const { handleList } = await cliModulePromise;
    const listToolsSpy = vi.fn((_name: string, options?: { includeSchema?: boolean }) =>
      Promise.resolve([
        {
          name: 'add',
          description: 'Add two numbers',
          inputSchema: options?.includeSchema
            ? {
                type: 'object',
                properties: {
                  a: { type: 'number', description: 'First operand' },
                  format: { type: 'string', enum: ['json', 'markdown'], description: 'Output serialization format' },
                  dueBefore: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp' },
                },
                required: ['a'],
              }
            : undefined,
          outputSchema: options?.includeSchema
            ? {
                type: 'object',
                properties: {
                  result: { type: 'array', description: 'List of calculation results' },
                  total: { type: 'number', description: 'Total results returned' },
                },
              }
            : undefined,
        },
      ])
    );
    const runtime = {
      getDefinition: (name: string) => ({
        name,
        description: 'Test integration server',
        command: { kind: 'http', url: new URL('https://example.com/mcp') },
      }),
      listTools: listToolsSpy,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['calculator']);

    const rawLines = logSpy.mock.calls.map((call) => call.join(' '));
    const lines = rawLines.map(stripAnsi);

    const headerLine = lines.find((line) => line.trim().startsWith('calculator -'));
    expect(headerLine).toBeDefined();
    const summaryLine = lines.find((line) => line.includes('HTTP https://example.com/mcp'));
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toMatch(/1 tool/);
    expect(summaryLine).toMatch(/ms/);
    expect(summaryLine).toContain('HTTP https://example.com/mcp');
    expect(lines.some((line) => line.includes('/**'))).toBe(true);
    const paramLineIndex = lines.findIndex((line) => line.includes('@param a'));
    expect(paramLineIndex).toBeGreaterThan(1);
    expect(lines[paramLineIndex - 1]?.trim()).toBe('*');
    expect(lines.some((line) => line.includes('@param a') && line.includes('First operand'))).toBe(true);
    expect(lines.some((line) => line.includes('function add('))).toBe(true);
    expect(lines.some((line) => line.includes('format?: "json" | "markdown"'))).toBe(true);
    expect(lines.some((line) => line.includes('dueBefore?: string'))).toBe(true);
    expect(lines.some((line) => line.includes('// optional'))).toBe(false);
    expect(lines.some((line) => line.includes('Examples:'))).toBe(true);
    expect(lines.some((line) => line.includes('mcporter call calculator.add(a: 1'))).toBe(true);
    expect(
      lines.some((line) => line.includes('Optional parameters hidden; run with --all-parameters to view all fields'))
    ).toBe(false);
    expect(listToolsSpy).toHaveBeenCalledWith('calculator', { includeSchema: true });

    logSpy.mockRestore();
  });

  it('summarizes hidden optional parameters and hints include flag', async () => {
    const { handleList } = await cliModulePromise;
    const listToolsSpy = vi.fn((_name: string, options?: { includeSchema?: boolean }) =>
      Promise.resolve([buildLinearDocumentsTool(options?.includeSchema)])
    );
    const runtime = {
      getDefinition: () => linearDefinition,
      listTools: listToolsSpy,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['linear']);

    const lines = logSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));
    expect(lines.some((line) => line.includes('function list_documents('))).toBe(true);
    expect(
      lines.some((line) => line.includes('// optional (4): projectId, initiativeId, creatorId, includeArchived'))
    ).toBe(true);
    expect(
      lines.some((line) => line.includes('Optional parameters hidden; run with --all-parameters to view all fields'))
    ).toBe(true);
    expect(listToolsSpy).toHaveBeenCalledWith('linear', { includeSchema: true });

    logSpy.mockRestore();
  });

  it('truncates long examples for readability', async () => {
    const { handleList } = await cliModulePromise;
    const listToolsSpy = vi.fn((_name: string, options?: { includeSchema?: boolean }) =>
      Promise.resolve([buildLinearDocumentsTool(options?.includeSchema)])
    );
    const runtime = {
      getDefinition: () => linearDefinition,
      listTools: listToolsSpy,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['linear']);

    const lines = logSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));
    const exampleLines = lines.filter((line) => line.includes('mcporter call linear.'));
    expect(exampleLines).toHaveLength(1);
    const exampleLine = exampleLines[0] as string;
    expect(exampleLine.length).toBeLessThanOrEqual(90);
    expect(exampleLine).toMatch(/, ...\)$/);

    logSpy.mockRestore();
  });

  it('indents multi-line parameter docs beneath the @param label', async () => {
    const { handleList } = await cliModulePromise;
    const listToolsSpy = vi.fn((_name: string, options?: { includeSchema?: boolean }) =>
      Promise.resolve([
        {
          name: 'list_projects',
          description: 'List Vercel projects',
          inputSchema: options?.includeSchema
            ? {
                type: 'object',
                properties: {
                  teamId: {
                    type: 'string',
                    description: `The team ID to target.\nTeam IDs start with "team_".\n- Read the file .vercel/project.json\n- Use the list_teams tool`,
                  },
                },
                required: ['teamId'],
              }
            : undefined,
        },
      ])
    );
    const runtime = {
      getDefinition: () => linearDefinition,
      listTools: listToolsSpy,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['linear']);

    const lines = logSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));
    expect(lines.some((line) => line.includes('@param teamId'))).toBe(true);
    const continuationLine = lines.find((line) => line.includes('Team IDs start with "team_"'));
    expect(continuationLine).toBeDefined();
    expect(continuationLine?.includes('*               Team IDs start with "team_"')).toBe(true);

    logSpy.mockRestore();
  });

  it('includes optional parameters when --all-parameters is set', async () => {
    const { handleList } = await cliModulePromise;
    const listToolsSpy = vi.fn((_name: string, options?: { includeSchema?: boolean }) =>
      Promise.resolve([buildLinearDocumentsTool(options?.includeSchema)])
    );
    const runtime = {
      getDefinition: () => linearDefinition,
      listTools: listToolsSpy,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['--all-parameters', 'linear']);

    const lines = logSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));

    const headerLine = lines.find((line) => line.trim().startsWith('linear -'));
    expect(headerLine).toBeDefined();
    const summaryLine = lines.find((line) => line.includes('HTTP https://example.com/mcp'));
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toMatch(/1 tool/);
    expect(summaryLine).toMatch(/ms/);
    expect(summaryLine).toContain('HTTP https://example.com/mcp');
    expect(lines.some((line) => line.includes('/**'))).toBe(true);
    expect(lines.some((line) => line.includes('@param limit?') && line.includes('Maximum number of documents'))).toBe(
      true
    );
    expect(lines.some((line) => line.includes('function list_documents('))).toBe(true);
    expect(lines.some((line) => line.includes('limit?: number'))).toBe(true);
    expect(lines.some((line) => line.includes('orderBy?: "createdAt" | "updatedAt"'))).toBe(true);
    expect(lines.some((line) => line.includes('includeArchived?: boolean'))).toBe(true);
    expect(listToolsSpy).toHaveBeenCalledWith('linear', { includeSchema: true });

    logSpy.mockRestore();
  });

  it('matches the expected formatted snapshot for a complex server', async () => {
    const { handleList } = await cliModulePromise;
    const listToolsSpy = vi.fn((_name: string, options?: { includeSchema?: boolean }) =>
      Promise.resolve([
        buildLinearDocumentsTool(options?.includeSchema),
        {
          name: 'create_comment',
          description: 'Create a comment on a specific Linear issue',
          inputSchema: options?.includeSchema
            ? {
                type: 'object',
                properties: {
                  issueId: { type: 'string', description: 'The issue ID' },
                  parentId: { type: 'string', description: 'Optional parent comment ID' },
                  body: { type: 'string', description: 'Comment body as Markdown' },
                },
                required: ['issueId', 'body'],
              }
            : undefined,
          outputSchema: options?.includeSchema
            ? {
                title: 'Comment',
                type: 'object',
              }
            : undefined,
        },
      ])
    );
    const runtime = {
      getDefinition: () => linearDefinition,
      listTools: listToolsSpy,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    await handleList(runtime, ['linear']);

    nowSpy.mockRestore();

    const lines = logSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));
    expect(lines.join('\n')).toMatchInlineSnapshot(`
      "linear - Hosted Linear MCP

        /**
         * List documents in the user's Linear workspace
         *
         * @param query The search query
         * @param limit? Maximum number of documents to return
         * @param before? Cursor to page backwards
         * @param after? Cursor to page forwards
         * @param orderBy? Sort order for the documents
         * @param projectId? Filter by project
         * @param initiativeId? Filter by initiative
         * @param creatorId? Filter by creator
         * @param includeArchived? Whether to include archived documents
         */
        function list_documents(query: string, limit?: number, before?: string, after?: string, orderBy?: "createdAt" | "updatedAt"): DocumentConnection;
        // optional (4): projectId, initiativeId, creatorId, includeArchived

        /**
         * Create a comment on a specific Linear issue
         *
         * @param issueId The issue ID
         * @param parentId? Optional parent comment ID
         * @param body Comment body as Markdown
         */
        function create_comment(issueId: string, parentId?: string, body: string): Comment;

        Examples:
          mcporter call linear.list_documents(query: "value", limit: 1, orderBy: "cr, ...)

        Optional parameters hidden; run with --all-parameters to view all fields.

        2 tools · 0ms · HTTP https://example.com/mcp
      "
    `);

    logSpy.mockRestore();
  });

  it('registers an ad-hoc HTTP server when URL is provided', async () => {
    const { handleList } = await cliModulePromise;
    const definitions = new Map<string, ServerDefinition>();
    const registerDefinition = vi.fn((definition: ServerDefinition) => {
      definitions.set(definition.name, definition);
    });
    const listTools = vi.fn(() => Promise.resolve([]));
    const runtime = {
      getDefinitions: () => Array.from(definitions.values()),
      getDefinition: (name: string) => {
        const definition = definitions.get(name);
        if (!definition) {
          throw new Error('missing');
        }
        return definition;
      },
      listTools,
      registerDefinition,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['https://mcp.example.com/mcp']);

    expect(registerDefinition).toHaveBeenCalled();
    expect(definitions.get('mcp-example-com-mcp')).toBeDefined();
    expect(listTools).toHaveBeenCalledWith('mcp-example-com-mcp', { includeSchema: true });

    logSpy.mockRestore();
  });

  it('auto-corrects unknown server names when the edit distance is small', async () => {
    const { handleList } = await cliModulePromise;
    const definition = linearDefinition;
    const getDefinition = vi.fn().mockImplementation((name: string) => {
      if (name === 'linear') {
        return definition;
      }
      throw new Error(`Unknown MCP server '${name}'.`);
    });
    const listTools = vi.fn(() => Promise.resolve([]));
    const runtime = {
      getDefinition,
      getDefinitions: () => [definition],
      listTools,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['linera']);

    expect(getDefinition).toHaveBeenCalledTimes(2);
    expect(listTools).toHaveBeenCalledWith('linear', { includeSchema: true });
    const messages = logSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));
    expect(messages.some((line) => line.includes('Auto-corrected server name to linear'))).toBe(true);

    logSpy.mockRestore();
  });

  it('suggests a server name when the typo is large', async () => {
    const { handleList } = await cliModulePromise;
    const definition = linearDefinition;
    const listTools = vi.fn();
    const runtime = {
      getDefinition: () => {
        throw new Error("Unknown MCP server 'zzz'");
      },
      getDefinitions: () => [definition],
      listTools,
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleList(runtime, ['zzz']);

    const errorLines = errorSpy.mock.calls.map((call) => stripAnsi(call.join(' ')));
    expect(errorLines.some((line) => line.includes('Did you mean linear?'))).toBe(true);
    expect(listTools).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
