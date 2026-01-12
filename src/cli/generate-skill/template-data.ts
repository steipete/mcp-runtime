import type { GenerateSkillOptions } from '../../generate-skill.js';
import type { SkillArtifactMetadata } from '../../skill-metadata.js';

export type InspectableSkillInvocation = SkillArtifactMetadata['invocation'] & {
  serverRef?: string;
};

export function buildGenerateSkillCommand(
  invocation: InspectableSkillInvocation,
  serverName: string,
  globalFlags: Record<string, string | undefined> = {}
): string {
  const tokens: string[] = ['mcporter'];
  const configPath = invocation.configPath ?? globalFlags['--config'];
  const rootDir = invocation.rootDir ?? globalFlags['--root'];
  if (configPath) {
    tokens.push('--config', configPath);
  }
  if (rootDir) {
    tokens.push('--root', rootDir);
  }
  tokens.push('generate-skill');

  const serverRef = invocation.serverRef ?? serverName;
  tokens.push('--server', serverRef);

  if (invocation.outputPath) {
    tokens.push('--output', invocation.outputPath);
  }
  if (invocation.bundler && invocation.bundler !== 'rolldown') {
    tokens.push('--bundler', invocation.bundler);
  }
  if (typeof invocation.bundle === 'string') {
    tokens.push('--bundle', invocation.bundle);
  } else if (invocation.bundle) {
    tokens.push('--bundle');
  }
  if (typeof invocation.compile === 'string') {
    tokens.push('--compile', invocation.compile);
  } else if (invocation.compile) {
    tokens.push('--compile');
  }
  if (invocation.runtime) {
    tokens.push('--runtime', invocation.runtime);
  }
  if (invocation.timeoutMs && invocation.timeoutMs !== 30_000) {
    tokens.push('--timeout', String(invocation.timeoutMs));
  }
  if (invocation.minify) {
    tokens.push('--minify');
  }
  if (invocation.includeTools && invocation.includeTools.length > 0) {
    tokens.push('--include-tools', invocation.includeTools.join(','));
  }
  if (invocation.excludeTools && invocation.excludeTools.length > 0) {
    tokens.push('--exclude-tools', invocation.excludeTools.join(','));
  }
  return tokens.map(shellQuote).join(' ');
}

export function resolveGenerateSkillRequestFromArtifact(
  parsed: {
    from?: string;
    server?: string;
    output?: string;
    runtime?: GenerateSkillOptions['runtime'];
    bundler?: GenerateSkillOptions['bundler'];
    bundle?: GenerateSkillOptions['bundle'];
    timeout: number;
    compile?: GenerateSkillOptions['compile'];
    minify?: boolean;
    includeTools?: string[];
    excludeTools?: string[];
  },
  metadata: SkillArtifactMetadata,
  globalFlags: Record<string, string | undefined>
): GenerateSkillOptions {
  if (!parsed.from) {
    throw new Error('Missing --from skill path.');
  }
  const invocation = { ...metadata.invocation };
  const serverRef = parsed.server ?? invocation.serverRef ?? metadata.server.name;
  if (!serverRef) {
    throw new Error('Unable to determine server definition from skill metadata; pass --server with a target name.');
  }

  const includeTools = parsed.includeTools ?? invocation.includeTools;
  const excludeTools = parsed.excludeTools ?? invocation.excludeTools;
  if (includeTools && excludeTools) {
    throw new Error('Cannot combine --include-tools and --exclude-tools.');
  }
  if (includeTools && includeTools.length === 0) {
    throw new Error('--include-tools requires at least one tool name.');
  }
  if (excludeTools && excludeTools.length === 0) {
    throw new Error('--exclude-tools requires at least one tool name.');
  }

  return {
    serverRef,
    configPath: globalFlags['--config'] ?? invocation.configPath,
    rootDir: globalFlags['--root'] ?? invocation.rootDir,
    outputPath: parsed.output ?? invocation.outputPath,
    runtime: parsed.runtime ?? invocation.runtime,
    bundler: parsed.bundler ?? invocation.bundler,
    bundle: parsed.bundle ?? invocation.bundle,
    timeoutMs: parsed.timeout ?? invocation.timeoutMs,
    compile: parsed.compile ?? invocation.compile,
    minify: parsed.minify ?? invocation.minify ?? false,
    includeTools,
    excludeTools,
  };
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./@%-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
