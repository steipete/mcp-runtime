import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureInvocationDefaults, fetchTools, resolveServerDefinition } from './cli/generate/definition.js';
import { resolveRuntimeKind } from './cli/generate/runtime.js';
import { readPackageMetadata } from './cli/generate/template.js';
import { applyToolFilters } from './cli/generate/tool-filters.js';
import { buildToolMetadata } from './cli/generate/tools.js';
import {
  buildSkillConfig,
  normalizeSkillDescription,
  normalizeSkillName,
  renderSkillMarkdown,
  renderToolsMarkdown,
} from './cli/generate-skill/template.js';
import { serializeDefinition } from './cli-metadata.js';
import { type SkillArtifactMetadata, writeSkillMetadata } from './skill-metadata.js';

export interface GenerateSkillOptions {
  readonly serverRef: string;
  readonly configPath?: string;
  readonly rootDir?: string;
  readonly outputPath?: string;
  readonly runtime?: 'node' | 'bun';
  readonly bundler?: 'rolldown' | 'bun';
  readonly bundle?: boolean | string;
  readonly timeoutMs?: number;
  readonly minify?: boolean;
  readonly compile?: boolean | string;
  readonly includeTools?: string[];
  readonly excludeTools?: string[];
}

export async function generateSkill(options: GenerateSkillOptions): Promise<{ outputPath: string }> {
  const runtimeKind = await resolveRuntimeKind(options.runtime, options.compile);
  const bundlerKind = options.bundler ?? (runtimeKind === 'bun' ? 'bun' : 'rolldown');
  if (bundlerKind === 'bun' && runtimeKind !== 'bun') {
    throw new Error('--bundler bun currently requires --runtime bun.');
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const { definition: baseDefinition, name } = await resolveServerDefinition(
    options.serverRef,
    options.configPath,
    options.rootDir
  );
  const { tools: allTools, derivedDescription } = await fetchTools(
    baseDefinition,
    name,
    options.configPath,
    options.rootDir
  );
  const tools = applyToolFilters(allTools, options.includeTools, options.excludeTools);
  const definition =
    baseDefinition.description || !derivedDescription
      ? baseDefinition
      : { ...baseDefinition, description: derivedDescription };
  const toolMetadata = tools.map((tool) => buildToolMetadata(tool));

  const generator = await readPackageMetadata();
  const baseInvocation = ensureInvocationDefaults(
    {
      serverRef: options.serverRef,
      configPath: options.configPath,
      rootDir: options.rootDir,
      runtime: runtimeKind,
      bundler: bundlerKind,
      outputPath: options.outputPath,
      bundle: options.bundle,
      compile: options.compile,
      timeoutMs,
      minify: options.minify ?? false,
      includeTools: options.includeTools,
      excludeTools: options.excludeTools,
    },
    definition
  );

  const skillName = normalizeSkillName(name);
  const skillDescription = normalizeSkillDescription(definition.description ?? derivedDescription, name);
  const outputDir = path.resolve(options.outputPath ?? path.join(process.cwd(), `${skillName}-skill`));

  const metadata: SkillArtifactMetadata = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator,
    server: {
      name,
      source: definition.source,
      definition: serializeDefinition(definition),
    },
    skill: {
      name: skillName,
      description: skillDescription,
      path: outputDir,
    },
    invocation: {
      ...baseInvocation,
      outputPath: outputDir,
    },
  };

  try {
    const existing = await fs.stat(outputDir);
    if (!existing.isDirectory()) {
      throw new Error(`Output path ${outputDir} is not a directory.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(outputDir, { recursive: true });
  const referencesDir = path.join(outputDir, 'references');
  const assetsDir = path.join(outputDir, 'assets');
  await fs.mkdir(referencesDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const templateInput = {
    skillName,
    description: skillDescription,
    serverName: name,
    tools: toolMetadata,
    generator,
    generatedAt: metadata.generatedAt,
  };

  await fs.writeFile(path.join(outputDir, 'SKILL.md'), renderSkillMarkdown(templateInput), 'utf8');
  await fs.writeFile(path.join(referencesDir, 'tools.md'), renderToolsMarkdown(templateInput), 'utf8');
  await fs.writeFile(
    path.join(assetsDir, 'mcporter.json'),
    JSON.stringify(buildSkillConfig(definition), null, 2),
    'utf8'
  );
  await writeSkillMetadata(outputDir, metadata);

  return { outputPath: outputDir };
}
