import { handleAddCommand, resolveWriteTarget } from './config/add.js';
import { handleLoginCommand, handleLogoutCommand } from './config/auth.js';
import { handleDoctorCommand } from './config/doctor.js';
import { handleGetCommand } from './config/get.js';
import { type ConfigSubcommand, consumeInlineHelpTokens, isHelpToken, printConfigHelp } from './config/help.js';
import { handleImportCommand } from './config/import.js';
import { handleListCommand } from './config/list.js';
import { handleRemoveCommand } from './config/remove.js';
import type { ConfigCliOptions } from './config/types.js';
import { CliUsageError } from './errors.js';

export async function handleConfigCli(options: ConfigCliOptions, args: string[]): Promise<void> {
  const initialToken = args[0];
  if (args.length === 0 || (initialToken && isHelpToken(initialToken))) {
    printConfigHelp();
    return;
  }

  const subcommand = args.shift();
  if (!subcommand) {
    printConfigHelp();
    return;
  }

  if (subcommand === 'help') {
    const target = args[0];
    if (!target || isHelpToken(target)) {
      printConfigHelp();
    } else {
      printConfigHelp(target);
    }
    return;
  }

  if (consumeInlineHelpTokens(args)) {
    printConfigHelp(subcommand);
    return;
  }

  switch (subcommand as ConfigSubcommand) {
    case 'list':
      await handleListCommand(options, args);
      return;
    case 'get':
      await handleGetCommand(options, args);
      return;
    case 'add':
      await handleAddCommand(options, args);
      return;
    case 'remove':
      await handleRemoveCommand(options, args);
      return;
    case 'import':
      await handleImportCommand(options, args);
      return;
    case 'login':
      await handleLoginCommand(options, args);
      return;
    case 'logout':
      await handleLogoutCommand(options, args);
      return;
    case 'doctor':
      await handleDoctorCommand(options, args);
      return;
    default:
      throw new CliUsageError(`Unknown config subcommand '${subcommand}'. Run 'mcporter config --help'.`);
  }
}

export const __configCommandInternals = {
  resolveWriteTarget,
};
