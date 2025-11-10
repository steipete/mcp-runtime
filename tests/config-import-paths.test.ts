import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { pathsForImport } from '../src/config-imports.js';

describe('pathsForImport on Windows', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;
  let homeSpy: ReturnType<typeof vi.spyOn>;
  const homeDir = path.join(os.tmpdir(), 'mcporter-win-home');
  const appData = path.join(homeDir, 'AppData', 'Roaming');

  beforeEach(() => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.APPDATA = appData;
    process.env.XDG_CONFIG_HOME = '';
  });

  afterEach(() => {
    platformSpy.mockRestore();
    homeSpy.mockRestore();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
  });

  it('includes Windows Cursor directories and workspace override', () => {
    const rootDir = 'C:/repo';
    const paths = pathsForImport('cursor', rootDir);
    expect(paths).toContain(path.resolve(rootDir, '.cursor', 'mcp.json'));
    expect(paths).toContain(path.join(homeDir, '.cursor', 'mcp.json'));
    expect(paths).toContain(path.join(appData, 'Cursor', 'User', 'mcp.json'));
  });

  it('includes Windows windsuf configs across Codeium directories', () => {
    const rootDir = 'C:/repo';
    const paths = pathsForImport('windsurf', rootDir);
    expect(paths).toContain(path.join(appData, 'Codeium', 'windsurf', 'mcp_config.json'));
    expect(paths).toContain(path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'));
  });

  it('prefers workspace .vscode/mcp.json before user-level VS Code configs', () => {
    const rootDir = 'C:/repo';
    const paths = pathsForImport('vscode', rootDir);
    expect(paths[0]).toBe(path.resolve(rootDir, '.vscode', 'mcp.json'));
    expect(paths).toContain(path.join(appData, 'Code', 'User', 'mcp.json'));
    expect(paths).toContain(path.join(appData, 'Code - Insiders', 'User', 'mcp.json'));
  });
});
