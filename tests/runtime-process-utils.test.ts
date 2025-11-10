import type { ChildProcess } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: execFileMock,
  };
});

describe('runtime-process-utils Windows process tree', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  });

  afterEach(() => {
    platformSpy.mockRestore();
  });

  it('parses PowerShell output to enumerate descendants', async () => {
    const { __testHooks } = await import('../src/runtime-process-utils.js');
    const rootPid = process.pid;
    const powershellOutput = JSON.stringify([
      { ProcessId: rootPid + 1, ParentProcessId: rootPid },
      { ProcessId: rootPid + 2, ParentProcessId: rootPid + 1 },
      { ProcessId: rootPid + 3, ParentProcessId: 42 },
    ]);

    execFileMock.mockImplementation((command, args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      if (command === 'powershell.exe') {
        cb?.(null, powershellOutput, '');
      } else {
        cb?.(new Error('unexpected command'));
      }
      return { pid: 1 } as ChildProcess;
    });

    const descendants = await __testHooks.listDescendantPids(rootPid);
    expect(descendants).toEqual([rootPid + 1, rootPid + 2]);
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-Command', expect.stringContaining('Get-CimInstance')]),
      expect.any(Object),
      expect.any(Function)
    );
  });
});
