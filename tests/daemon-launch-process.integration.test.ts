import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureDistBuilt } from './helpers/dist.js';
import { privateFixtureDirectory } from './helpers/private-directory.js';
import { budget } from './helpers/timing.js';

const runNode = promisify(execFile);
const launchModule = new URL('../dist/daemon/launch.js', import.meta.url);

beforeAll(async () => {
  await ensureDistBuilt(fileURLToPath(launchModule));
});

describe('detached daemon spawn failures in a real process', () => {
  it('returns an asynchronous ENOENT from the launch command to the caller', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-daemon-launch-error-'));
    try {
      const script = `
        import assert from 'node:assert/strict';
        import { spawn } from 'node:child_process';
        import { launchDaemonDetached } from ${JSON.stringify(launchModule.href)};
        let closed;
        const launched = launchDaemonDetached({
          configPath: ${JSON.stringify(path.join(tempDir, 'config.json'))},
          socketPath: ${JSON.stringify(path.join(tempDir, 'daemon.sock'))},
          metadataPath: ${JSON.stringify(path.join(tempDir, 'daemon.json'))},
        }, (_command, args, options) => {
          const child = spawn(${JSON.stringify(path.join(tempDir, 'missing-daemon'))}, args, options);
          closed = new Promise(resolve => child.once('close', resolve));
          return child;
        });
        // Do not register an error listener here: production must handle it.
        await assert.rejects(launched, error => {
          assert.match(error.message, /Failed to start MCPorter daemon.*ENOENT/);
          assert.ok(error.cause instanceof Error);
          assert.equal(error.cause.code, 'ENOENT');
          return true;
        });
        await closed;
        console.log('reported daemon spawn failure');
      `;
      const scriptPath = path.join(tempDir, 'proof.mjs');
      await fs.writeFile(scriptPath, script);
      const { stdout, stderr } = await runNode(process.execPath, [scriptPath], {
        timeout: budget(10_000),
      });
      expect(stdout.trim()).toBe('reported daemon spawn failure');
      expect(stderr).toBe('');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each(['daemon start', 'auto-launch'] as const)('reports the real spawn error from %s', async (mode) => {
    const tempDir = await privateFixtureDirectory('mcp-launch-');
    try {
      const missingCommand = path.join(tempDir, 'missing-daemon');
      const script = `
        import assert from 'node:assert/strict';
        import { handleDaemonCli } from ${JSON.stringify(new URL('../dist/cli/daemon-command.js', import.meta.url).href)};
        import { DaemonClient } from ${JSON.stringify(new URL('../dist/daemon/client.js', import.meta.url).href)};
        const options = { configPath: ${JSON.stringify(path.join(tempDir, 'config.json'))} };
        // Use a genuinely missing executable without mocking launch or readiness.
        Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(missingCommand)} });
        const start = ${JSON.stringify(mode)} === 'daemon start'
          ? () => handleDaemonCli(['start'], options)
          : () => new DaemonClient(options).ensureDaemon();
        await assert.rejects(start, error => {
          assert.match(error.message, /Failed to start MCPorter daemon.*missing-daemon.*ENOENT/);
          assert.ok(error.cause instanceof Error);
          assert.equal(error.cause.code, 'ENOENT');
          assert.equal(error.cause.path, ${JSON.stringify(missingCommand)});
          return true;
        });
        console.log('reported daemon spawn failure');
      `;
      const scriptPath = path.join(tempDir, 'proof.mjs');
      await fs.writeFile(scriptPath, script);
      const { stdout, stderr } = await runNode(process.execPath, [scriptPath], {
        env: { ...process.env, MCPORTER_DAEMON_DIR: tempDir, MCPORTER_DAEMON_CHILD: '0' },
        timeout: budget(10_000),
      });
      expect(stdout.trim()).toBe('reported daemon spawn failure');
      expect(stderr).toBe('');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
