import fs from 'node:fs/promises';
import path from 'node:path';
import { pathsForImport, readExternalEntries } from './config-imports.js';
import { normalizeServerEntry } from './config-normalize.js';
import {
  DEFAULT_IMPORTS,
  type LoadConfigOptions,
  type RawConfig,
  RawConfigSchema,
  type RawEntry,
  RawEntrySchema,
  type ServerDefinition,
  type ServerSource,
} from './config-schema.js';
import { expandHome } from './env.js';

export { toFileUrl } from './config-imports.js';
export { __configInternals } from './config-normalize.js';
export type {
  CommandSpec,
  HttpCommand,
  LoadConfigOptions,
  ServerDefinition,
  ServerSource,
  StdioCommand,
} from './config-schema.js';

export async function loadServerDefinitions(options: LoadConfigOptions = {}): Promise<ServerDefinition[]> {
  const rootDir = options.rootDir ?? process.cwd();
  const { path: configPath, explicit } = resolveConfigPath(options.configPath, rootDir);
  const config = await readConfigFile(configPath, explicit);

  const merged = new Map<string, { raw: RawEntry; baseDir: string; source: ServerSource }>();

  const configuredImports = config.imports;
  const imports = configuredImports
    ? configuredImports.length === 0
      ? configuredImports
      : [...configuredImports, ...DEFAULT_IMPORTS.filter((kind) => !configuredImports.includes(kind))]
    : DEFAULT_IMPORTS;
  for (const importKind of imports) {
    const candidates = pathsForImport(importKind, rootDir);
    for (const candidate of candidates) {
      const resolved = expandHome(candidate);
      const entries = await readExternalEntries(resolved);
      if (!entries) {
        continue;
      }
      for (const [name, rawEntry] of entries) {
        if (merged.has(name)) {
          continue;
        }
        merged.set(name, {
          raw: rawEntry,
          baseDir: path.dirname(resolved),
          source: { kind: 'import', path: resolved },
        });
      }
    }
  }

  for (const [name, entryRaw] of Object.entries(config.mcpServers)) {
    merged.set(name, {
      raw: RawEntrySchema.parse(entryRaw),
      baseDir: rootDir,
      source: { kind: 'local', path: configPath },
    });
  }

  const servers: ServerDefinition[] = [];
  for (const [name, { raw, baseDir: entryBaseDir, source }] of merged) {
    servers.push(normalizeServerEntry(name, raw, entryBaseDir, source));
  }

  return servers;
}

function resolveConfigPath(configPath: string | undefined, rootDir: string): { path: string; explicit: boolean } {
  if (configPath) {
    return { path: path.resolve(configPath), explicit: true };
  }
  return { path: path.resolve(rootDir, 'config', 'mcporter.json'), explicit: false };
}

async function readConfigFile(configPath: string, explicit: boolean): Promise<RawConfig> {
  try {
    const buffer = await fs.readFile(configPath, 'utf8');
    return RawConfigSchema.parse(JSON.parse(buffer));
  } catch (error) {
    if (!explicit && isErrno(error, 'ENOENT')) {
      return { mcpServers: {}, imports: [] };
    }
    throw error;
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code);
}
