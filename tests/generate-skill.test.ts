import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateSkill } from '../src/generate-skill.js';
import { readSkillMetadata } from '../src/skill-metadata.js';

const describeGenerateSkill = process.platform === 'win32' ? describe.skip : describe;

let baseUrl: URL;
const tmpDir = path.join(process.cwd(), 'tmp', 'mcporter-skill-tests');

if (process.platform !== 'win32') {
  beforeAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    const app = express();
    app.use(express.json());

    const server = new McpServer({ name: 'integration', version: '1.0.0' });
    server.registerTool(
      'add',
      {
        title: 'Add',
        description: 'Add two numbers',
        inputSchema: { a: z.number(), b: z.number() },
        outputSchema: { result: z.number() },
      },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: JSON.stringify({ result: Number(a) + Number(b) }) }],
        structuredContent: { result: Number(a) + Number(b) },
      })
    );

    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to obtain test server address');
    }
    baseUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

    afterAll(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
  });
}

describeGenerateSkill('generateSkill', () => {
  it('creates a skill folder with metadata, config, and tool docs', async () => {
    const inline = JSON.stringify({
      name: 'integration',
      description: 'Test integration server',
      command: baseUrl.toString(),
    });
    const outputDir = path.join(tmpDir, 'integration-skill');
    await fs.rm(outputDir, { recursive: true, force: true });

    const { outputPath } = await generateSkill({
      serverRef: inline,
      outputPath: outputDir,
      timeoutMs: 5_000,
    });
    expect(outputPath).toBe(outputDir);

    const skillMd = await fs.readFile(path.join(outputDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: "integration"');
    expect(skillMd).toContain('Use this skill');

    const toolsMd = await fs.readFile(path.join(outputDir, 'references', 'tools.md'), 'utf8');
    expect(toolsMd).toContain('add');

    const config = JSON.parse(await fs.readFile(path.join(outputDir, 'assets', 'mcporter.json'), 'utf8')) as {
      mcpServers: Record<string, { url?: string }>;
    };
    expect(config.mcpServers.integration?.url).toBe(baseUrl.toString());

    const metadata = await readSkillMetadata(outputDir);
    expect(metadata.skill.name).toBe('integration');
    expect(metadata.server.name).toBe('integration');

    const relocatedDir = path.join(tmpDir, 'integration-skill-relocated');
    await fs.rm(relocatedDir, { recursive: true, force: true });
    await fs.rename(outputDir, relocatedDir);
    const relocatedMetadata = await readSkillMetadata(path.join(relocatedDir, '.mcporter-skill.json'));
    expect(relocatedMetadata.skill.path).toBe(relocatedDir);
    expect(relocatedMetadata.invocation.outputPath).toBe(relocatedDir);
  });
});
