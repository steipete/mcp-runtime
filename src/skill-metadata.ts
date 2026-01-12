import fs from 'node:fs/promises';
import path from 'node:path';
import type { CliArtifactMetadata, SerializedServerDefinition } from './cli-metadata.js';
import type { ServerSource } from './config.js';

export const SKILL_METADATA_FILENAME = '.mcporter-skill.json';

export interface SkillArtifactMetadata {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly generator: {
    readonly name: string;
    readonly version: string;
  };
  readonly server: {
    readonly name: string;
    readonly source?: ServerSource;
    readonly definition: SerializedServerDefinition;
  };
  readonly skill: {
    readonly name: string;
    readonly description: string;
    readonly path: string;
  };
  readonly invocation: CliArtifactMetadata['invocation'];
}

export function skillMetadataPath(skillDir: string): string {
  return path.join(skillDir, SKILL_METADATA_FILENAME);
}

export async function writeSkillMetadata(skillDir: string, metadata: SkillArtifactMetadata): Promise<void> {
  const resolvedPath = skillMetadataPath(skillDir);
  await fs.writeFile(resolvedPath, JSON.stringify(metadata, null, 2), 'utf8');
}

export async function readSkillMetadata(targetPath: string): Promise<SkillArtifactMetadata> {
  const resolved = path.resolve(targetPath);
  let metadataPath = resolved;
  let skillDir = resolved;
  try {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      metadataPath = skillMetadataPath(resolved);
      skillDir = resolved;
    } else {
      skillDir = path.dirname(resolved);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    throw new Error(`Skill artifact not found at ${resolved}`);
  }
  const buffer = await fs.readFile(metadataPath, 'utf8');
  const parsed = JSON.parse(buffer) as SkillArtifactMetadata;
  const originalSkillPath = parsed.skill.path;
  const invocation = { ...parsed.invocation };
  if (!invocation.outputPath || invocation.outputPath === originalSkillPath) {
    invocation.outputPath = skillDir;
  }
  return {
    ...parsed,
    skill: {
      ...parsed.skill,
      path: skillDir,
    },
    invocation,
  };
}
