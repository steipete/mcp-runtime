import type { LoadConfigOptions } from '../../config.js';

export interface ConfigCliOptions {
  readonly loadOptions: LoadConfigOptions;
  readonly invokeAuth: (args: string[]) => Promise<void>;
}

export type ConfigScope = 'home' | 'project';
