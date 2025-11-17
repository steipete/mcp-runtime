import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LoadConfigOptions, RawConfig } from '../../src/config.js';

type TempConfigCtx = {
  tempDir: string;
  configPath: string;
  loadOptions: LoadConfigOptions;
  cleanup(): Promise<void>;
};

export async function createTempConfig(initial?: RawConfig): Promise<TempConfigCtx> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-config-fixture-'));
  const configPath = path.join(tempDir, 'config', 'mcporter.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  if (initial) {
    await fs.writeFile(configPath, JSON.stringify(initial), 'utf8');
  }
  const loadOptions: LoadConfigOptions = { rootDir: tempDir, configPath };
  return {
    tempDir,
    configPath,
    loadOptions,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}
