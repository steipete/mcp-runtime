import { loadServerDefinitions } from '../../config.js';
import { CliUsageError } from '../errors.js';
import { printServerSummary, serializeDefinition } from './render.js';
import { resolveServerDefinition } from './shared.js';
import type { ConfigCliOptions } from './types.js';

export async function handleGetCommand(options: ConfigCliOptions, args: string[]): Promise<void> {
  const flags = extractGetFlags(args);
  const name = args.shift();
  if (!name) {
    throw new CliUsageError('Usage: mcporter config get <name>');
  }
  const servers = await loadServerDefinitions(options.loadOptions);
  const target = resolveServerDefinition(name, servers);
  if (flags.format === 'json') {
    console.log(JSON.stringify(serializeDefinition(target), null, 2));
    return;
  }
  printServerSummary(target);
  if (target.command.kind === 'http' && target.command.headers && Object.keys(target.command.headers).length > 0) {
    console.log('  Headers:');
    for (const [key, value] of Object.entries(target.command.headers)) {
      console.log(`    ${key}: ${value}`);
    }
  }
  if (target.env && Object.keys(target.env).length > 0) {
    console.log('  Env:');
    for (const [key, value] of Object.entries(target.env)) {
      console.log(`    ${key}=${value}`);
    }
  }
}

function extractGetFlags(args: string[]): { format: 'text' | 'json' } {
  let format: 'text' | 'json' = 'text';
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (token === '--json') {
      format = 'json';
      args.splice(index, 1);
      continue;
    }
    index += 1;
  }
  return { format };
}
