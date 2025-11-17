import os from 'node:os';
import path from 'node:path';

export function normalizeProjectPath(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  return path.resolve(expandHomeShortcut(input));
}

function expandHomeShortcut(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function pathsEqual(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
