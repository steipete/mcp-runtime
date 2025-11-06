import { describe, expect, it, vi } from 'vitest';

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

  it('parses function-call syntax with named arguments', async () => {
    const { parseCallArguments } = await cliModulePromise;
    const parsed = parseCallArguments(['linear.create_comment(issueId: "ISSUE-123", body: "Hello", notify: false)']);
    expect(parsed.selector).toBeUndefined();
    expect(parsed.server).toBe('linear');
    expect(parsed.tool).toBe('create_comment');
    expect(parsed.args).toEqual({ issueId: 'ISSUE-123', body: 'Hello', notify: false });
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

  it('requires named arguments in the call expression', async () => {
    const { parseCallArguments } = await cliModulePromise;
    expect(() => parseCallArguments(['linear.create_comment("oops")'])).toThrow(
      'Function-call syntax requires named arguments (e.g. issueId: 123).'
    );
  });

  it('throws when trailing tokens lack key=value formatting', async () => {
    const { parseCallArguments } = await cliModulePromise;
    expect(() => parseCallArguments(['chrome-devtools', 'list_pages', 'oops'])).toThrow(
      "Argument 'oops' must be key=value format."
    );
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
});
