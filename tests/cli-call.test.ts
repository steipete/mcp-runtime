import { describe, expect, it, vi } from 'vitest';
import { CliUsageError } from '../src/cli/errors.js';
import type { ServerDefinition } from '../src/config.js';

process.env.MCPORTER_DISABLE_AUTORUN = '1';
const cliModulePromise = import('../src/cli.js');

describe('CLI call argument parsing', () => {
  it('falls back to default call timeout when env is empty', async () => {
    vi.stubEnv('MCPORTER_CALL_TIMEOUT', '');
    try {
      const { resolveCallTimeout } = await cliModulePromise;
      expect(resolveCallTimeout()).toBe(60_000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('accepts server and tool as separate positional arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', 'list_pages']);
    expect(parsed.selector).toBe('chrome-devtools');
    expect(parsed.tool).toBe('list_pages');
    expect(parsed.args).toEqual({});
  });

  it('maps tool=NAME tokens to the tool selector', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', 'tool=list_pages']);
    expect(parsed.selector).toBe('chrome-devtools');
    expect(parsed.tool).toBe('list_pages');
    expect(parsed.args).toEqual({});
  });

  it('treats command=NAME tokens as a tool alias for compatibility', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', 'command=list_pages']);
    expect(parsed.selector).toBe('chrome-devtools');
    expect(parsed.tool).toBe('list_pages');
    expect(parsed.args).toEqual({});
  });

  it('captures timeout flag values', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', '--timeout', '2500', '--tool', 'list_pages']);
    expect(parsed.selector).toBe('chrome-devtools');
    expect(parsed.tool).toBe('list_pages');
    expect(parsed.timeoutMs).toBe(2500);
  });

  it('retains key=value arguments after the selector and tool', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', 'list_pages', 'timeout=500']);
    expect(parsed.selector).toBe('chrome-devtools');
    expect(parsed.tool).toBe('list_pages');
    expect(parsed.args).toEqual({ timeout: 500 });
  });

  it('accepts inline key:value arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', 'list_pages', 'timeout:500']);
    expect(parsed.args).toEqual({ timeout: 500 });
  });

  it('accepts spaced key: value arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['chrome-devtools', 'list_pages', 'timeout:', '500']);
    expect(parsed.args).toEqual({ timeout: 500 });
  });

  it('parses function-call syntax with named arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['linear.create_comment(issueId: "ISSUE-123", body: "Hello", notify: false)']);
    expect(parsed.selector).toBeUndefined();
    expect(parsed.server).toBe('linear');
    expect(parsed.tool).toBe('create_comment');
    expect(parsed.args).toEqual({ issueId: 'ISSUE-123', body: 'Hello', notify: false });
  });

  it('parses HTTP call expressions with named arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments([
      'https://www.shadcn.io/api/mcp.getComponent(component: "vortex", hydrate: true)',
    ]);
    expect(parsed.server).toBe('https://www.shadcn.io/api/mcp');
    expect(parsed.tool).toBe('getComponent');
    expect(parsed.args).toEqual({ component: 'vortex', hydrate: true });
  });

  it('parses scheme-less HTTP call expressions with named arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['shadcn.io/api/mcp.getComponent(component: "vortex", hydrate: true)']);
    expect(parsed.server).toBe('https://shadcn.io/api/mcp');
    expect(parsed.tool).toBe('getComponent');
    expect(parsed.args).toEqual({ component: 'vortex', hydrate: true });
  });

  it('splits scheme-less dotted HTTP selectors without parentheses into base URL + tool', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['shadcn.io/api/mcp.getComponents', 'limit=3']);
    expect(parsed.server).toBe('https://shadcn.io/api/mcp');
    expect(parsed.tool).toBe('getComponents');
    expect(parsed.args).toEqual({ limit: 3 });
  });

  it('treats unlabeled trailing arguments as positional values', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['https://shadcn.io/api/mcp.getComponent', 'vortex']);
    expect(parsed.server).toBe('https://shadcn.io/api/mcp');
    expect(parsed.tool).toBe('getComponent');
    expect(parsed.positionalArgs).toEqual(['vortex']);
  });

  it('parses positional function-call arguments when labels are omitted', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['context7.resolve-library-id("value", 2)']);
    expect(parsed.server).toBe('context7');
    expect(parsed.tool).toBe('resolve-library-id');
    expect(parsed.positionalArgs).toEqual(['value', 2]);
  });

  it('supports function-call syntax when the server is provided separately', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['--server', 'linear', 'create_comment(issueId: "123")']);
    expect(parsed.server).toBe('linear');
    expect(parsed.tool).toBe('create_comment');
    expect(parsed.args).toEqual({ issueId: '123' });
  });

  it('rejects conflicting server names between flags and call syntax', async () => {
    const { parseCallArguments } = await cliModulePromise;
    expect(() => parseCallArguments(['--server', 'github', 'linear.create_comment(issueId: "123")'])).toThrow(
      "Conflicting server names: 'github' from flags and 'linear' from call expression."
    );
  });

  it('surfaces a helpful error when function-call syntax cannot be parsed', async () => {
    const { parseCallArguments } = await cliModulePromise;
    expect(() => parseCallArguments(['linear.create_comment(oops)'])).toThrow(CliUsageError);
  });

  it('aborts long-running tools when the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const { handleCall } = await cliModulePromise;
      const close = vi.fn().mockResolvedValue(undefined);
      const runtime = {
        callTool: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('done'), 1000);
          }),
        close,
      };
      const promise = handleCall(runtime as never, ['chrome-devtools.list_pages', '--timeout', '10']);
      const expectation = expect(promise).rejects.toThrow('Call to chrome-devtools.list_pages timed out after 10ms.');
      await vi.runOnlyPendingTimersAsync();
      await expectation;
      expect(close).toHaveBeenCalledWith('chrome-devtools');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-corrects near-miss tool names', async () => {
    const { handleCall } = await cliModulePromise;
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error('MCP error -32602: Tool listIssues not found'))
      .mockResolvedValueOnce({ ok: true });
    const listTools = vi.fn().mockResolvedValue([{ name: 'list_issues' }]);
    const runtime = {
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleCall(runtime, ['linear.listIssues']);

    const notes = logSpy.mock.calls.map((call) => call.join(' '));
    expect(notes.some((line) => line.includes('Auto-corrected tool call to linear.list_issues'))).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenNthCalledWith(1, 'linear', 'listIssues', { args: {} });
    expect(callTool).toHaveBeenNthCalledWith(2, 'linear', 'list_issues', { args: {} });
    expect(listTools).toHaveBeenCalledWith('linear');

    logSpy.mockRestore();
  });

  it('suggests similar tool names when the match is uncertain', async () => {
    const { handleCall } = await cliModulePromise;
    const callTool = vi.fn().mockRejectedValue(new Error('MCP error -32602: Tool listIssues not found'));
    const listTools = vi.fn().mockResolvedValue([{ name: 'list_issue_statuses' }]);
    const runtime = {
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleCall(runtime, ['linear.listIssues'])).rejects.toThrow('Tool listIssues not found');

    const errors = errorSpy.mock.calls.map((call) => call.join(' '));
    expect(errors.some((line) => line.includes('Did you mean linear.list_issue_statuses'))).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(listTools).toHaveBeenCalledWith('linear');

    errorSpy.mockRestore();
  });

  it('falls back to the original error when tool listings fail', async () => {
    const { handleCall } = await cliModulePromise;
    const callError = new Error('MCP error -32602: Tool listIssues not found');
    const callTool = vi.fn().mockRejectedValue(callError);
    const listTools = vi.fn().mockRejectedValue(new Error('auth required'));
    const runtime = {
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleCall(runtime, ['linear.listIssues'])).rejects.toThrow(callError.message);

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(listTools).toHaveBeenCalledWith('linear');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not suggest alternatives for non tool-not-found errors', async () => {
    const { handleCall } = await cliModulePromise;
    const failure = new Error('MCP error -32000: Connection closed');
    const callTool = vi.fn().mockRejectedValue(failure);
    const listTools = vi.fn();
    const runtime = {
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleCall(runtime, ['linear.listIssues'])).rejects.toThrow(failure.message);

    expect(listTools).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('appears offline');

    errorSpy.mockRestore();
  });

  it('reports when servers appear offline after call failures', async () => {
    const { handleCall } = await cliModulePromise;
    const failure = new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:9999');
    const runtime = {
      callTool: vi.fn().mockRejectedValue(failure),
      listTools: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handleCall(runtime, ['linear.listIssues'])).rejects.toThrow(failure.message);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('appears offline');
    errorSpy.mockRestore();
  });

  it('reports stdio exit codes when transports terminate', async () => {
    const { handleCall } = await cliModulePromise;
    const failure = new Error('STDIO transport exited with code 1 (signal SIGTERM)');
    const runtime = {
      callTool: vi.fn().mockRejectedValue(failure),
      listTools: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handleCall(runtime, ['chrome-devtools.list_pages'])).rejects.toThrow(failure.message);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('STDIO server for chrome-devtools exited with code 1');
    errorSpy.mockRestore();
  });

  it('emits structured JSON payloads for connection issues when --output json is set', async () => {
    const { handleCall } = await cliModulePromise;
    const failure = new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:9999');
    const runtime = {
      callTool: vi.fn().mockRejectedValue(failure),
      listTools: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleCall(runtime, ['linear.listIssues', '--output', 'json'])).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}');
    expect(payload.server).toBe('linear');
    expect(payload.issue.kind).toBe('offline');

    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('maps positional function arguments using schema order', async () => {
    const { handleCall } = await cliModulePromise;
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const listTools = vi.fn().mockResolvedValue([
      {
        name: 'resolve-library-id',
        description: 'Lookup',
        inputSchema: {
          type: 'object',
          properties: {
            libraryName: { type: 'string' },
            region: { type: 'string' },
          },
          required: ['libraryName'],
        },
      },
    ]);

    const runtime = {
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await handleCall(runtime, ['context7.resolve-library-id("library", "us-east-1")']);

    expect(callTool).toHaveBeenCalledWith('context7', 'resolve-library-id', {
      args: { libraryName: 'library', region: 'us-east-1' },
    });
  });

  it('reuses configured servers when targeting an HTTP URL', async () => {
    const { handleCall } = await cliModulePromise;
    const definition: ServerDefinition = {
      name: 'vercel',
      command: { kind: 'http', url: new URL('https://mcp.vercel.com') },
      source: { kind: 'local', path: '/tmp/config.json' },
    } as ServerDefinition;
    const registerDefinition = vi.fn();
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const runtime = {
      getDefinitions: () => [definition],
      registerDefinition,
      callTool,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await handleCall(runtime, ['--server', 'https://mcp.vercel.com', '--tool', 'list_projects']);

    expect(callTool).toHaveBeenCalledWith('vercel', 'list_projects', { args: {} });
    expect(registerDefinition).not.toHaveBeenCalled();
  });

  it('reuses HTTP servers when the tool name is appended to the URL', async () => {
    const { handleCall } = await cliModulePromise;
    const definition: ServerDefinition = {
      name: 'shadcn',
      command: { kind: 'http', url: new URL('https://www.shadcn.io/api/mcp') },
      source: { kind: 'local', path: '/tmp/config.json' },
    } as ServerDefinition;
    const registerDefinition = vi.fn();
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const runtime = {
      getDefinitions: () => [definition],
      registerDefinition,
      callTool,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await handleCall(runtime, ['https://www.shadcn.io/api/mcp.getComponent', 'component=vortex']);

    expect(callTool).toHaveBeenCalledWith('shadcn', 'getComponent', { args: { component: 'vortex' } });
    expect(registerDefinition).not.toHaveBeenCalled();
  });

  it('maps positional values after HTTP selectors using schema order', async () => {
    const { handleCall } = await cliModulePromise;
    const definition: ServerDefinition = {
      name: 'shadcn',
      command: { kind: 'http', url: new URL('https://www.shadcn.io/api/mcp') },
      source: { kind: 'local', path: '/tmp/config.json' },
    } as ServerDefinition;
    const registerDefinition = vi.fn();
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const listTools = vi.fn().mockResolvedValue([
      {
        name: 'getComponent',
        description: 'Fetch component',
        inputSchema: {
          type: 'object',
          properties: {
            component: { type: 'string' },
          },
          required: ['component'],
        },
      },
    ]);
    const runtime = {
      getDefinitions: () => [definition],
      registerDefinition,
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await handleCall(runtime, ['https://www.shadcn.io/api/mcp.getComponent', 'vortex']);

    expect(callTool).toHaveBeenCalledWith('shadcn', 'getComponent', { args: { component: 'vortex' } });
    expect(registerDefinition).not.toHaveBeenCalled();
  });

  it('reuses HTTP servers when the scheme is omitted', async () => {
    const { handleCall } = await cliModulePromise;
    const definition: ServerDefinition = {
      name: 'shadcn',
      command: { kind: 'http', url: new URL('https://www.shadcn.io/api/mcp') },
      source: { kind: 'local', path: '/tmp/config.json' },
    } as ServerDefinition;
    const registerDefinition = vi.fn();
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const runtime = {
      getDefinitions: () => [definition],
      registerDefinition,
      callTool,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await handleCall(runtime, ['shadcn.io/api/mcp.getComponent', 'component=vortex']);

    expect(callTool).toHaveBeenCalledWith('shadcn', 'getComponent', { args: { component: 'vortex' } });
    expect(registerDefinition).not.toHaveBeenCalled();
  });

  it('errors when too many positional arguments are supplied', async () => {
    const { handleCall } = await cliModulePromise;
    const callTool = vi.fn();
    const listTools = vi.fn().mockResolvedValue([
      {
        name: 'resolve-library-id',
        description: 'Lookup',
        inputSchema: {
          type: 'object',
          properties: {
            libraryName: { type: 'string' },
          },
          required: ['libraryName'],
        },
      },
    ]);
    const runtime = {
      callTool,
      listTools,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await expect(handleCall(runtime, ['context7.resolve-library-id("a", "b")'])).rejects.toThrow(
      /Too many positional arguments/
    );
  });

  it('errors when schema data is unavailable for positional arguments', async () => {
    const { handleCall } = await cliModulePromise;
    const runtime = {
      callTool: vi.fn(),
      listTools: vi.fn().mockResolvedValue([{ name: 'resolve-library-id' }]),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await expect(handleCall(runtime, ['context7.resolve-library-id("a")'])).rejects.toThrow(
      /does not expose an input schema/
    );
  });

  it('registers an ad-hoc HTTP server when --http-url is provided', async () => {
    const { handleCall } = await cliModulePromise;
    const definitions = new Map<string, ServerDefinition>();
    const registerDefinition = vi.fn((definition: ServerDefinition) => {
      definitions.set(definition.name, definition);
    });
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const runtime = {
      getDefinitions: () => Array.from(definitions.values()),
      registerDefinition,
      callTool,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;

    await handleCall(runtime, ['--http-url', 'https://mcp.example.com/mcp', '--tool', 'status']);

    expect(registerDefinition).toHaveBeenCalled();
    expect(definitions.get('mcp-example-com-mcp')).toBeDefined();
    expect(callTool).toHaveBeenCalledWith('mcp-example-com-mcp', 'status', { args: {} });
  });
});
