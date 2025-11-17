import { writeRawConfig } from '../../config.js';
import { CliUsageError } from '../errors.js';
import { cloneConfig, findServerNameWithFuzzyMatch, loadOrCreateConfig } from './shared.js';
import type { ConfigCliOptions } from './types.js';

export async function handleRemoveCommand(options: ConfigCliOptions, args: string[]): Promise<void> {
  const name = args.shift();
  if (!name) {
    throw new CliUsageError('Usage: mcporter config remove <name>');
  }
  const { config, path: configPath } = await loadOrCreateConfig(options.loadOptions);
  const targetName = findServerNameWithFuzzyMatch(name, Object.keys(config.mcpServers ?? {}));
  if (!targetName) {
    throw new CliUsageError(`Server '${name}' does not exist in ${configPath}.`);
  }
  const nextConfig = cloneConfig(config);
  delete nextConfig.mcpServers[targetName];
  await writeRawConfig(configPath, nextConfig);
  console.log(`Removed '${targetName}' from ${configPath}`);
}
