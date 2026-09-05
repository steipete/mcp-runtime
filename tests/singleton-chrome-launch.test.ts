import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ServerDefinition } from '../src/config.js';
import { DaemonBroker } from '../src/daemon/broker.js';
import { createRuntime } from '../src/runtime.js';

vi.mock('../src/runtime.js', () => ({ createRuntime: vi.fn() }));

const plain: ServerDefinition = {
  name: 'chrome-devtools',
  command: { kind: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp'], cwd: os.tmpdir() },
  lifecycle: { mode: 'keep-alive' },
};
const canonical: ServerDefinition = {
  ...plain,
  command: {
    ...plain.command,
    kind: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp', '--autoConnect'],
    cwd: os.tmpdir(),
  },
  chromeDevtoolsRelay: 'off',
};
const tools = [{ name: 'list_pages', inputSchema: { type: 'object' } }];
const listTools = vi.fn(async () => tools);

beforeEach(() => {
  vi.stubEnv('MCPORTER_DAEMON_DIR', path.join(os.userInfo().homedir, '.mcporter'));
  vi.mocked(createRuntime).mockResolvedValue({
    connect: async () => ({ transport: {}, client: {} }),
    listTools,
    close: async () => {},
  } as unknown as Awaited<ReturnType<typeof createRuntime>>);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

for (const state of ['empty', 'configured', 'reserved'])
  for (const customClient of [false, true])
    it(`discovers plain npx Chrome tools with ${state} owner and custom client=${customClient}`, async () => {
      const broker = new DaemonBroker(state === 'empty' ? [] : [canonical]);
      try {
        expect(broker.status()).toMatchObject({ views: 0, servers: [] });
        if (state === 'reserved') {
          const handle = broker.register({ definitions: [canonical] });
          await broker.invoke({ id: 'owner', method: 'listTools', params: { server: canonical.name }, ...handle });
        }
        const ownerBefore = broker.status().browserOwner;
        const handle = broker.register({
          definitions: [plain],
          ...(customClient ? { clientInfo: { name: 'generated-chrome-cli', version: '1' } } : {}),
        });
        await expect(
          broker.invoke({ id: 'plain', method: 'listTools', params: { server: plain.name }, ...handle })
        ).resolves.toEqual(tools);
        expect(listTools).toHaveBeenLastCalledWith(plain.name, expect.any(Object));
        expect(vi.mocked(createRuntime).mock.lastCall?.[0]?.servers?.[0]).toMatchObject(plain);
        expect(broker.status().browserOwner).toEqual(ownerBefore);
        expect(broker.status().servers.at(-1)?.idleBlocked).toBeUndefined();
        expect(broker.canIdleShutdown()).toBe(state !== 'reserved');
      } finally {
        await broker.close();
      }
    });

it.each([
  ['npx', ['-y', 'chrome-devtools-mcp', '--browserUrl', 'http://127.0.0.1:9222']],
  ['npx', ['-y', 'chrome-devtools-mcp', '--wsEndpoint=ws://127.0.0.1:9222']],
  ['npx', ['-y', 'chrome-devtools-mcp', '-uhttp://127.0.0.1:9222']],
  ['npx', ['-y', 'chrome-devtools-mcp', '-wws://127.0.0.1:9222']],
  ['npx', ['-y', 'chrome-devtools-mcp', '-e/fixture/chrome']],
  ['npx', ['-y', 'chrome-devtools-mcp', '-xu', 'http://127.0.0.1:9222']],
  ['npx', ['-y', 'chrome-devtools-mcp', '-xw', 'ws://127.0.0.1:9222']],
  ['npx', ['-y', 'chrome-devtools-mcp', '-xe', '/fixture/chrome']],
  ['sh', ['-c', 'chrome-devtools-mcp --autoConnect']],
  ['sh', ['-c', '$CHROME_LAUNCH']],
  ['npx', ['--call=chrome-devtools-mcp --autoConnect']],
])('refuses unsafe Chrome launch %s %j before discovery without claiming an owner exists', async (command, args) => {
  const broker = new DaemonBroker();
  try {
    const handle = broker.register({
      definitions: [
        {
          ...plain,
          command: { kind: 'stdio', command, args, cwd: os.tmpdir() },
          env: { CHROME_LAUNCH: 'chrome-devtools-mcp --autoConnect' },
        },
      ],
    });
    await expect(
      broker.invoke({ id: 'unsafe', method: 'listTools', params: { server: plain.name }, ...handle })
    ).rejects.toMatchObject({
      code: 'browser_owner_conflict',
      message: expect.stringMatching(/^Existing Chrome request refused: .*may reach an existing browser/),
    });
    expect(createRuntime).not.toHaveBeenCalled();
    expect(broker.status().browserOwner).toBeUndefined();
    expect(broker.canIdleShutdown()).toBe(true);
  } finally {
    await broker.close();
  }
});

it('still refuses auto-connect with a custom MCP client identity', async () => {
  const broker = new DaemonBroker([canonical]);
  try {
    const handle = broker.register({ definitions: [canonical], clientInfo: { name: 'custom', version: '1' } });
    await expect(
      broker.invoke({ id: 'custom', method: 'listTools', params: { server: canonical.name }, ...handle })
    ).rejects.toMatchObject({
      code: 'browser_owner_conflict',
      message: expect.stringContaining('requires the canonical MCP client identity'),
    });
    expect(createRuntime).not.toHaveBeenCalled();
  } finally {
    await broker.close();
  }
});

it.each(['--autoConnect', '--browserUrl=http://127.0.0.1:9222', '--wsEndpoint=ws://127.0.0.1:9222'])(
  'keeps interpolated %s under existing-Chrome authority',
  async (target) => {
    const definition: ServerDefinition = {
      ...plain,
      command: {
        kind: 'stdio',
        command: '${CHROME_LAUNCHER}',
        args: ['-y', 'chrome-devtools-mcp', '${CHROME_TARGET}'],
        cwd: os.tmpdir(),
      },
      env: { CHROME_LAUNCHER: 'npx', CHROME_TARGET: target },
    };
    const broker = new DaemonBroker([canonical]);
    try {
      for (const clientInfo of [undefined, { name: 'custom', version: '1' }]) {
        const handle = broker.register({ definitions: [definition], clientInfo });
        await expect(
          broker.invoke({ id: 'interpolated', method: 'listTools', params: { server: plain.name }, ...handle })
        ).rejects.toMatchObject({ code: 'browser_owner_conflict' });
      }
      expect(createRuntime).not.toHaveBeenCalled();
      expect(broker.status().browserOwner).toBeUndefined();
    } finally {
      await broker.close();
    }
  }
);

it('still refuses existing Chrome in an isolated daemon directory', async () => {
  vi.stubEnv('MCPORTER_DAEMON_DIR', path.join(os.tmpdir(), 'mcporter-isolated-chrome-refusal'));
  const broker = new DaemonBroker([canonical]);
  try {
    const handle = broker.register({ definitions: [canonical] });
    await expect(
      broker.invoke({ id: 'isolated', method: 'listTools', params: { server: canonical.name }, ...handle })
    ).rejects.toMatchObject({
      code: 'browser_owner_conflict',
      message: expect.stringContaining('forbidden in an isolated daemon directory'),
    });
    expect(createRuntime).not.toHaveBeenCalled();
  } finally {
    await broker.close();
  }
});
