import { type GenerateSkillOptions, generateSkill } from '../../generate-skill.js';

export async function performGenerateSkillFromArtifact(request: GenerateSkillOptions): Promise<void> {
  const { outputPath } = await generateSkill(request);
  console.log(`Regenerated skill at ${outputPath}`);
}

export async function performGenerateSkillFromRequest(request: GenerateSkillOptions): Promise<void> {
  const { outputPath } = await generateSkill(request);
  console.log(`Generated skill at ${outputPath}`);
}
