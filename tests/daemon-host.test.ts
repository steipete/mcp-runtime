import { describe, expect, it } from 'vitest';
import type { ServerDefinition } from '../src/config.js';
import { __testProcessRequest } from '../src/daemon/host.js';
import type { DaemonRequest } from '../src/daemon/protocol.js';
import type { Runtime } from '../src/runtime.js';

describe('daemon host request handling', () => {
  it('reuses pre-parsed requests without reparsing payloads', async () => {
    const metadata = {
      configPath: '/tmp/config.json',
      configLayers: [],
      configMtimeMs: Date.now(),
      socketPath: '/tmp/socket',
      startedAt: Date.now(),
      logPath: null,
    };
    const logContext = { enabled: false, logAllServers: false, servers: new Set<string>() };

    const parsedRequest: DaemonRequest = { id: '1', method: 'status', params: {} };
    const result = await __testProcessRequest(
      '!!!invalid-json!!!',
      {} as Runtime,
      new Map<string, ServerDefinition>(),
      new Map(),
      metadata,
      logContext,
      parsedRequest
    );

    expect(result.response.ok).toBe(true);
    expect(result.shouldShutdown).toBe(false);
  });
});
