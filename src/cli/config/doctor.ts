import path from 'node:path';
import { loadServerDefinitions } from '../../config.js';
import { MCPORTER_VERSION } from '../../runtime.js';
import { logConfigLocations, resolveConfigLocations } from './shared.js';
import type { ConfigCliOptions } from './types.js';

export async function handleDoctorCommand(options: ConfigCliOptions, _args: string[]): Promise<void> {
  console.log(`MCPorter ${MCPORTER_VERSION}`);
  const configLocations = await resolveConfigLocations(options.loadOptions);
  logConfigLocations(configLocations, { leadingNewline: false });
  console.log('');
  const servers = await loadServerDefinitions(options.loadOptions);
  const issues: string[] = [];
  for (const server of servers) {
    if (server.command.kind === 'stdio' && !path.isAbsolute(server.command.cwd)) {
      issues.push(`Server '${server.name}' has a non-absolute working directory.`);
    }
    if (server.auth === 'oauth' && !server.tokenCacheDir) {
      issues.push(`Server '${server.name}' enables OAuth but lacks a token cache directory.`);
    }
  }
  if (issues.length === 0) {
    console.log('Config looks good.');
    return;
  }
  console.log('Config issues detected:');
  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }
}
