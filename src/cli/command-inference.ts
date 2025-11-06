import type { ServerDefinition } from '../config.js';
import { chooseClosestIdentifier } from './identifier-helpers.js';
import { dimText, yellowText } from './terminal.js';

type CommandResult = { kind: 'command'; command: string; args: string[] } | { kind: 'abort'; exitCode: number };

const CALL_TOKEN_PATTERN = /[.(]/;

export function inferCommandRouting(
  token: string,
  args: string[],
  definitions: readonly ServerDefinition[]
): CommandResult {
  if (!token) {
    return { kind: 'command', command: token, args };
  }

  if (isExplicitCommand(token)) {
    return { kind: 'command', command: token, args };
  }

  if (isUrlToken(token)) {
    return { kind: 'command', command: 'list', args: [token, ...args] };
  }

  if (isCallLikeToken(token)) {
    return { kind: 'command', command: 'call', args: [token, ...args] };
  }

  if (definitions.length === 0) {
    return { kind: 'command', command: token, args };
  }

  const serverNames = definitions.map((entry) => entry.name);
  if (serverNames.includes(token)) {
    return { kind: 'command', command: 'list', args: [token, ...args] };
  }

  const resolution = chooseClosestIdentifier(token, serverNames);
  if (!resolution) {
    return { kind: 'command', command: token, args };
  }

  if (resolution.kind === 'auto') {
    console.log(dimText(`[mcporter] Auto-corrected server name to ${resolution.value} (input: ${token}).`));
    return { kind: 'command', command: 'list', args: [resolution.value, ...args] };
  }

  console.error(yellowText(`[mcporter] Did you mean ${resolution.value}?`));
  console.error(`Unknown MCP server '${token}'.`);
  return { kind: 'abort', exitCode: 1 };
}

function isCallLikeToken(token: string): boolean {
  if (!token) {
    return false;
  }
  if (/^https?:/i.test(token)) {
    return false;
  }
  return CALL_TOKEN_PATTERN.test(token);
}

function isExplicitCommand(token: string): boolean {
  return token === 'list' || token === 'call' || token === 'auth';
}

function isUrlToken(token: string): boolean {
  return /^https?:\/\//i.test(token);
}
