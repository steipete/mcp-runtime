import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServerDefinition } from '../src/config.js';
import { createClientContext } from '../src/runtime/transport.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const clientInfo = { name: 'mcporter', version: '0.0.0-test' };

afterEach(() => {
  vi.restoreAllMocks();
});

function stubHttpDefinition(url: string): ServerDefinition {
  return {
    name: 'http-server',
    command: { kind: 'http', url: new URL(url) },
    source: { kind: 'local', path: '<adhoc>' },
  };
}

describe('createClientContext (HTTP)', () => {
  it('falls back to SSE when primary connect fails', async () => {
    const definition = stubHttpDefinition('https://example.com/mcp');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

    const clientConnect = vi
      .spyOn(Client.prototype, 'connect')
      .mockImplementationOnce(async (transport) => {
        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        throw new Error('network down');
      })
      .mockImplementationOnce(async (transport) => {
        expect(transport).toBeInstanceOf(SSEClientTransport);
      });

    const context = await createClientContext(definition, logger, clientInfo, { maxOAuthAttempts: 0 });

    expect(context.transport).toBeInstanceOf(SSEClientTransport);
    expect(clientConnect).toHaveBeenCalledTimes(2);
  });

  it('promotes ad-hoc HTTP servers to OAuth after unauthorized, then retries', async () => {
    const definition = stubHttpDefinition('https://example.com/secure');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

    const clientConnect = vi
      .spyOn(Client.prototype, 'connect')
      .mockImplementationOnce(async () => {
        throw new Error('SSE error: Non-200 status code (401)');
      })
      .mockImplementationOnce(async () => {});

    const context = await createClientContext(definition, logger, clientInfo, { maxOAuthAttempts: 1 });

    expect(context.definition.auth).toBe('oauth');
    expect(clientConnect).toHaveBeenCalledTimes(2);
  });
});
