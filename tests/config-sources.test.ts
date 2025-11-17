import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadServerDefinitions } from '../src/config.js';

describe('config sources tracking', () => {
  let tempDir: string;
  let originalCwd: string;
  let restoreHomedir: (() => void) | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-config-sources-'));
    process.chdir(tempDir);
    const spy = vi.spyOn(os, 'homedir');
    spy.mockReturnValue(tempDir);
    restoreHomedir = () => spy.mockRestore();
  });

  afterEach(async () => {
    restoreHomedir?.();
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('keeps primary definition first and includes alternate sources when duplicates exist', async () => {
    const projectConfigPath = path.join(tempDir, 'config', 'mcporter.json');
    await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      JSON.stringify(
        { imports: ['cursor'], mcpServers: { alpha: { baseUrl: 'https://primary.example.com/mcp' } } },
        null,
        2
      ),
      'utf8'
    );

    const cursorConfigPath = path.join(tempDir, '.cursor', 'mcp.json');
    await fs.mkdir(path.dirname(cursorConfigPath), { recursive: true });
    await fs.writeFile(
      cursorConfigPath,
      JSON.stringify({ mcpServers: { alpha: { baseUrl: 'https://shadow.example.com/mcp' } } }, null, 2),
      'utf8'
    );

    const definitions = await loadServerDefinitions({ configPath: projectConfigPath, rootDir: tempDir });

    expect(definitions).toHaveLength(1);
    const definition = definitions[0];
    if (!definition) {
      throw new Error('definition should be present');
    }
    expect(definition.source?.path).toBe(projectConfigPath);
    expect(definition.sources?.map((entry) => entry.path)).toEqual([projectConfigPath, cursorConfigPath]);
  });
});
