import { pathToFileURL } from 'node:url';
import { readExternalEntries } from './config/imports/external.js';
import { pathsForImport } from './config/imports/paths.js';
import type { ImportKind, RawEntry } from './config-schema.js';

export { pathsForImport, readExternalEntries };

export function toFileUrl(filePath: string): URL {
  return pathToFileURL(filePath);
}

export type { ImportKind, RawEntry };
