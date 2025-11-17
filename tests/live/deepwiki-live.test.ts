import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const LIVE_FLAG = process.env.MCP_LIVE_TESTS === '1';
const ENDPOINTS = [
  { name: 'streamable-http', url: 'https://mcp.deepwiki.com/mcp' },
  { name: 'sse', url: 'https://mcp.deepwiki.com/sse' },
];

const execFileAsync = promisify(execFile);

function skipReason(): string | undefined {
  if (!LIVE_FLAG) {
    return 'set MCP_LIVE_TESTS=1 to run live MCP tests';
  }
  return undefined;
}

describe.skipIf(Boolean(skipReason()))('deepwiki live', () => {
  ENDPOINTS.forEach(({ name, url }) => {
    it(`lists wiki structure via ${name}`, async () => {
      const { stdout, stderr } = await execFileAsync('node', [
        'dist/cli.js',
        'call',
        url,
        'read_wiki_structure',
        'repoName:facebook/react',
        '--output',
        'json',
      ]);
      const normalized = stdout.trim() || stderr.trim();
      // Response comes back as a JS-object literal string; just assert it contains the section list.
      expect(normalized).toContain('Available pages for facebook/react');
      expect(normalized).toContain('Overview');
    }, 30_000);
  });
});
