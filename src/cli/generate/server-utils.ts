import { looksLikeHttpUrl, normalizeHttpUrlCandidate } from '../http-utils.js';
import type { CommandInput } from './types.js';

export function buildInlineServerDefinition(
  name: string,
  command: CommandInput,
  description?: string
): Record<string, unknown> {
  if (typeof command === 'string') {
    const url = normalizeHttpUrlCandidate(command) ?? command;
    if (looksLikeHttpUrl(command)) {
      return {
        name,
        description,
        command: url,
      };
    }
    return {
      name,
      description,
      command: {
        kind: 'http',
        url: new URL(url),
      },
      source: { kind: 'local', path: '<adhoc>' },
    };
  }
  return {
    name,
    description,
    command: {
      kind: 'stdio',
      command: command.command,
      args: command.args ?? [],
    },
    source: { kind: 'local', path: '<adhoc>' },
  };
}
