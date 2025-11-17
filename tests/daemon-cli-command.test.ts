import { beforeEach, describe, expect, it, vi } from 'vitest';

const stopMock = vi.fn();
const statusMock = vi.fn();
const mkdirMock = vi.fn();
const launchDaemonDetachedMock = vi.fn();
const runDaemonHostMock = vi.fn();
const createRuntimeMock = vi.fn();
const isKeepAliveServerMock = vi.fn(() => true);
const DaemonClientMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: { mkdir: mkdirMock },
  mkdir: mkdirMock,
}));

vi.mock('../src/daemon/client.js', () => ({
  DaemonClient: DaemonClientMock,
  resolveDaemonPaths: vi.fn(() => ({
    key: 'abc123',
    socketPath: '/tmp/socket',
    metadataPath: '/tmp/meta',
  })),
}));

vi.mock('../src/daemon/launch.js', () => ({
  launchDaemonDetached: launchDaemonDetachedMock,
}));

vi.mock('../src/daemon/host.js', () => ({
  runDaemonHost: runDaemonHostMock,
}));

vi.mock('../src/daemon/paths.js', () => ({
  getDaemonLogPath: vi.fn(() => '/tmp/mock-daemon.log'),
}));

vi.mock('../src/env.js', () => ({
  expandHome: (value: string) => value,
}));

vi.mock('../src/runtime.js', () => ({
  createRuntime: (...args: Parameters<typeof createRuntimeMock>) => createRuntimeMock(...args),
}));

vi.mock('../src/lifecycle.js', () => ({
  isKeepAliveServer: (...args: Parameters<typeof isKeepAliveServerMock>) => isKeepAliveServerMock(...args),
}));

const { handleDaemonCli } = await import('../src/cli/daemon-command.js');

describe('daemon CLI restart', () => {
  beforeEach(() => {
    stopMock.mockReset();
    statusMock.mockReset();
    mkdirMock.mockReset();
    launchDaemonDetachedMock.mockReset();
    runDaemonHostMock.mockReset();
    createRuntimeMock.mockReset();
    isKeepAliveServerMock.mockReset();
    DaemonClientMock.mockReset();
    DaemonClientMock.mockImplementation(function MockDaemonClient() {
      return {
        stop: stopMock,
        status: statusMock,
      };
    });
    stopMock.mockResolvedValue(undefined);

    const closeMock = vi.fn().mockResolvedValue(undefined);
    createRuntimeMock.mockResolvedValue({
      getDefinitions: () => [{ name: 'daemon-e2e', lifecycle: 'keep-alive' }],
      close: closeMock,
    });
    isKeepAliveServerMock.mockReturnValue(true);
    mkdirMock.mockResolvedValue(undefined);
  });

  it('stops the daemon and launches a fresh instance while honoring log flags', async () => {
    statusMock
      .mockResolvedValueOnce(null) // restart wait sees daemon already stopped
      .mockResolvedValueOnce(null) // handleDaemonStart: no existing daemon
      .mockResolvedValueOnce(null) // waitFor: daemon not ready yet
      .mockResolvedValueOnce({ pid: 420, socketPath: '/tmp/socket', servers: [], logPath: '/tmp/mock-daemon.log' });

    await handleDaemonCli(['restart', '--log'], { configPath: '/tmp/config.json' });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(launchDaemonDetachedMock).toHaveBeenCalledWith({
      configPath: '/tmp/config.json',
      rootDir: undefined,
      metadataPath: '/tmp/meta',
      socketPath: '/tmp/socket',
      extraArgs: ['--log-file', '/tmp/mock-daemon.log'],
    });
  });
});
