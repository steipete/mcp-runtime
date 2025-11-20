import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathsForImport, readExternalEntries } from '../src/config-imports.js';

const TEMP_DIR = path.join(os.tmpdir(), 'mcporter-config-imports-unit');

describe('config import helpers', () => {
  let homedirSpy: { mockRestore(): void } | undefined;
  let previousAppData: string | undefined;
  let previousXdg: string | undefined;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = undefined;
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it('parses JSON files that use the mcpServers container', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'cursor.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        mcpServers: {
          cursor: {
            baseUrl: 'https://cursor.local/mcp',
            headers: { Authorization: 'Bearer dev' },
          },
        },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath);
    expect(entries).not.toBeNull();
    const cursor = entries?.get('cursor');
    expect(cursor?.baseUrl).toBe('https://cursor.local/mcp');
    expect(cursor?.headers?.Authorization).toBe('Bearer dev');
  });

  it('parses Codex-style TOML configs', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const tomlPath = path.join(TEMP_DIR, 'codex.toml');
    await fs.writeFile(
      tomlPath,
      `
        [mcp_servers.test]
        description = "Codex"
        baseUrl = "https://codex.local/mcp"
        bearerToken = "abc"
      `,
      'utf8'
    );
    const entries = await readExternalEntries(tomlPath);
    const testEntry = entries?.get('test');
    expect(testEntry).toBeDefined();
    expect(testEntry?.baseUrl).toBe('https://codex.local/mcp');
    expect(testEntry?.headers?.Authorization).toBe('Bearer abc');
  });

  it('treats empty JSON import files as having no entries', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'claude.json');
    await fs.writeFile(jsonPath, '\n', 'utf8');
    const entries = await readExternalEntries(jsonPath);
    expect(entries).toBeDefined();
    expect(entries?.size ?? 0).toBe(0);
  });

  it('ignores malformed JSON import files', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'broken.json');
    await fs.writeFile(jsonPath, '{"oops":', 'utf8');
    const entries = await readExternalEntries(jsonPath);
    expect(entries).toBeDefined();
    expect(entries?.size ?? 0).toBe(0);
  });

  it('ignores malformed TOML import files', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const tomlPath = path.join(TEMP_DIR, 'broken.toml');
    await fs.writeFile(
      tomlPath,
      `[
        baseUrl = "https://example.com"
      `,
      'utf8'
    );
    const entries = await readExternalEntries(tomlPath);
    expect(entries).toBeDefined();
    expect(entries?.size ?? 0).toBe(0);
  });

  it('prefers config.toml when resolving Codex imports', () => {
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue('/fake/home');
    const rootDir = '/repo/project';
    const imports = pathsForImport('codex', rootDir);
    expect(imports).toEqual([
      path.resolve(rootDir, '.codex', 'config.toml'),
      path.join('/fake/home', '.codex', 'config.toml'),
    ]);
  });

  it('includes Claude project-scoped servers that match the root directory', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'claude-project.json');
    const projectRoot = path.join(TEMP_DIR, 'workspace');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        projects: {
          [projectRoot]: {
            mcpServers: {
              repo: {
                command: 'node --version',
                args: ['--verbose'],
              },
            },
          },
          '/other/project': {
            mcpServers: {
              ignored: { command: 'echo' },
            },
          },
        },
        tipsHistory: { foo: 1 },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath, { projectRoot });
    expect(entries?.size).toBe(1);
    const repo = entries?.get('repo');
    expect(repo?.command).toBe('node --version');
    expect(repo?.args).toEqual(['--verbose']);
  });

  it('ignores non-server keys in Claude configs without user mcpServers', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'claude-empty.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        cachedStatsigGates: { example: true },
        tipsHistory: { foo: 1 },
        projects: {
          '/no/match': {
            mcpServers: {},
          },
        },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath, { projectRoot: path.join(TEMP_DIR, 'workspace') });
    expect(entries?.size ?? 0).toBe(0);
  });

  it('parses opencode mcp containers and ignores root-level entries when missing', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'opencode.jsonc');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        mcp: {
          demo: {
            command: 'node',
            args: ['server.js'],
          },
        },
        stray: {
          command: 'echo',
        },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath, { importKind: 'opencode' });
    expect(entries?.size).toBe(1);
    expect(entries?.has('demo')).toBe(true);

    await fs.writeFile(jsonPath, JSON.stringify({ demo: { command: 'node' } }), 'utf8');
    const fallbackEntries = await readExternalEntries(jsonPath, { importKind: 'opencode' });
    expect(fallbackEntries?.size ?? 0).toBe(0);
  });

  it('generates cursor import paths relative to project root and user config dir', () => {
    previousAppData = process.env.APPDATA;
    previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(os.tmpdir(), 'xdg-home');
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue('/fake/home');
    const rootDir = '/repo/project';
    const paths = pathsForImport('cursor', rootDir);
    expect(paths[0]).toBe(path.resolve(rootDir, '.cursor', 'mcp.json'));
    expect(paths).toContain(path.join('/fake/home', '.cursor', 'mcp.json'));
    const cursorUserSuffix = path.join('Cursor', 'User', 'mcp.json');
    expect(paths.some((candidate) => candidate.endsWith(cursorUserSuffix))).toBe(true);
  });

  it('prevents root fallback for .claude/settings.json with non-MCP fields', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'settings.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        statusLine: { type: 'command', command: 'bash script.sh' },
        tipsHistory: { shown: ['tip1', 'tip2'] },
        cachedStatsigGates: { someFlag: true },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath, { importKind: 'claude-code' });
    expect(entries?.size ?? 0).toBe(0);
  });

  it('allows root fallback for .claude.json legacy format', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, '.claude.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        'my-server': {
          command: 'node',
          args: ['server.js'],
        },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath, { importKind: 'claude-code' });
    expect(entries?.size).toBe(1);
    expect(entries?.has('my-server')).toBe(true);
  });

  it('uses mcpServers container in settings.json when present', async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const jsonPath = path.join(TEMP_DIR, 'settings.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        statusLine: { type: 'command', command: 'bash script.sh' },
        mcpServers: {
          'real-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      }),
      'utf8'
    );
    const entries = await readExternalEntries(jsonPath, { importKind: 'claude-code' });
    expect(entries?.size).toBe(1);
    expect(entries?.has('real-server')).toBe(true);
    expect(entries?.has('statusLine')).toBe(false);
  });
});
