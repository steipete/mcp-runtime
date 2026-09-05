import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildDaemonLaunchInvocation, launchDaemonDetached, type DaemonLaunchOptions } from '../src/daemon/launch.js';

const options: DaemonLaunchOptions = {
  configPath: '/tmp/mcporter/config.json',
  configExplicit: true,
  rootDir: '/tmp/project',
  socketPath: '/tmp/mcporter/daemon.sock',
  metadataPath: '/tmp/mcporter/daemon.json',
  extraArgs: ['--log-file', '/tmp/mcporter/daemon.log'],
};

describe('launchDaemonDetached', () => {
  it('waits for spawn and unreferences the detached daemon without waiting for exit', async () => {
    const child = new EventEmitter() as ChildProcess;
    const unref = vi.fn();
    child.unref = unref;
    const launch = vi.fn(() => child);
    const settled = vi.fn();

    const launched = launchDaemonDetached(options, launch as typeof spawn).then(settled);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();
    child.emit('spawn');
    await launched;

    expect(launch).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['daemon', 'start', '--foreground']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(unref).toHaveBeenCalled();
    expect(settled).toHaveBeenCalledOnce();
    expect(() => child.emit('error', new Error('late child error'))).not.toThrow();
    expect(() => child.emit('error', new Error('another late child error'))).not.toThrow();
    await expect(launched).resolves.toBeUndefined();
  });

  it.each(['ENOENT', 'EACCES'])('reports %s with the launch command and original cause', async (code) => {
    const child = new EventEmitter() as ChildProcess;
    const error = Object.assign(new Error(code), { code });
    const unref = vi.fn(() => child.emit('error', error));
    child.unref = unref;
    const launch = vi.fn(() => child);

    await expect(launchDaemonDetached(options, launch as typeof spawn)).rejects.toMatchObject({
      message: `Failed to start MCPorter daemon (${process.execPath}): ${code}`,
      cause: error,
    });
    expect(() => child.emit('error', error)).not.toThrow();
    expect(unref).toHaveBeenCalled();
  });

  it('reports synchronous spawn failures through the same rejection path', async () => {
    const error = new Error('spawn failed');
    const launch = vi.fn(() => {
      throw error;
    });
    await expect(launchDaemonDetached(options, launch)).rejects.toMatchObject({
      message: `Failed to start MCPorter daemon (${process.execPath}): spawn failed`,
      cause: error,
    });
  });
});

describe('buildDaemonLaunchInvocation', () => {
  it('launches Node entrypoints directly with the CLI script path', () => {
    const invocation = buildDaemonLaunchInvocation(options, {
      argvEntry: '/repo/dist/cli.js',
      env: { PATH: '/usr/bin' },
      execArgv: ['--enable-source-maps'],
      execPath: '/usr/local/bin/node',
      platform: 'darwin',
    });

    expect(invocation.command).toBe('/usr/local/bin/node');
    expect(invocation.args).toEqual([
      '--enable-source-maps',
      fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
      'daemon',
      'start',
      '--foreground',
      '--log-file',
      '/tmp/mcporter/daemon.log',
    ]);
    expect(invocation.env.MCPORTER_DAEMON_CHILD).toBe('1');
    expect(invocation.env.MCPORTER_DAEMON_SOCKET).toBe('/tmp/mcporter/daemon.sock');
    expect(invocation.env.MCPORTER_DAEMON_METADATA).toBe('/tmp/mcporter/daemon.json');
  });

  it('wraps compiled Bun binaries with nohup on macOS so detached self-spawn survives Tahoe', () => {
    const invocation = buildDaemonLaunchInvocation(options, {
      argvEntry: '/$bunfs/root/mcporter',
      env: { PATH: '/usr/bin' },
      execArgv: [],
      execPath: '/opt/homebrew/bin/mcporter',
      platform: 'darwin',
    });

    expect(invocation.command).toBe('nohup');
    expect(invocation.args).toEqual([
      '/opt/homebrew/bin/mcporter',
      'daemon',
      'start',
      '--foreground',
      '--log-file',
      '/tmp/mcporter/daemon.log',
    ]);
    expect(invocation.env.MCPORTER_DAEMON_CHILD).toBe('1');
  });

  it('keeps non-macOS compiled launches on the direct exec path', () => {
    const invocation = buildDaemonLaunchInvocation(options, {
      argvEntry: '/$bunfs/root/mcporter',
      env: {},
      execArgv: [],
      execPath: '/usr/local/bin/mcporter',
      platform: 'linux',
    });

    expect(invocation.command).toBe('/usr/local/bin/mcporter');
    expect(invocation.args[0]).toBe('daemon');
    expect(invocation.args).not.toContain('--config');
    expect(invocation.env.MCPORTER_DISABLE_AUTORUN).toBe('0');
  });
});
