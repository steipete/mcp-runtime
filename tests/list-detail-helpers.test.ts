import { describe, expect, it } from 'vitest';
import type { GeneratedOption } from '../src/cli/generate/tools.js';
import {
  buildDocComment,
  buildToolDoc,
  formatCallExpressionExample,
  formatFunctionSignature,
  formatOptionalSummary,
  selectDisplayOptions,
  wrapCommentText,
} from '../src/cli/list-detail-helpers.js';

const baseOption = (overrides: Partial<GeneratedOption> = {}): GeneratedOption => ({
  property: 'field',
  cliName: 'field',
  description: 'desc',
  required: true,
  type: 'string',
  placeholder: '<field>',
  ...overrides,
});

describe('wrapCommentText', () => {
  it('wraps long sentences across multiple lines', () => {
    const text = 'This is a very long sentence designed to exceed the width limit and therefore wrap neatly.';
    const lines = wrapCommentText(text, 40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text.trim());
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });
});

describe('selectDisplayOptions', () => {
  it('always shows at least five parameters even when optional', () => {
    const options = Array.from({ length: 6 }, (_, index) => baseOption({ property: `opt${index}`, required: false }));
    const { displayOptions, hiddenOptions } = selectDisplayOptions(options, true, 5);
    expect(displayOptions).toHaveLength(5);
    expect(hiddenOptions).toHaveLength(1);
  });
});

describe('buildDocComment', () => {
  it('inserts a blank line between description and parameter docs and wraps content', () => {
    const options = [
      baseOption({
        property: 'teamId',
        description:
          'The team ID to get the deployment events for. Alternatively the team slug can be used. Team IDs start with "team_". If you do not know the team ID or slug, it can be found through these mechanism: Read the file .vercel/project.json, Use the list_teams tool',
      }),
    ];
    const lines = buildDocComment('List Vercel projects with lots of details.', options);
    expect(lines).toBeDefined();
    const printable = (lines ?? []).map(stripAnsi);
    const separatorIndex = printable.findIndex((line) => line.trim() === '*');
    expect(separatorIndex).toBeGreaterThan(0);
    const paramLine = printable.find((line) => line.includes('@param teamId'));
    expect(paramLine).toBeDefined();
    const continuationLine = printable.find((line) => line.includes('Team IDs start with'));
    expect(continuationLine).toBeDefined();
  });
});

describe('formatOptionalSummary', () => {
  it('shows at most five names and appends ellipsis for the rest', () => {
    const hidden = Array.from({ length: 7 }, (_, index) => baseOption({ property: `param${index}` }));
    const summary = stripAnsi(formatOptionalSummary(hidden));
    expect(summary).toContain('optional (7)');
    expect(summary).toContain('param0');
    expect(summary.trim().endsWith('...')).toBe(true);
  });
});

describe('formatFunctionSignature', () => {
  it('renders uncolored TypeScript-style signatures when colorize is false', () => {
    const signature = formatFunctionSignature(
      'create_comment',
      [
        baseOption({ property: 'issueId', description: 'Issue identifier', required: true }),
        baseOption({ property: 'parentId', required: false, description: 'Optional parent' }),
      ],
      { title: 'Comment' },
      { colorize: false }
    );
    expect(signature).toBe('function create_comment(issueId: string, parentId?: string): Comment;');
  });

  it('falls back to unknown return types when schema is empty', () => {
    const signature = stripAnsi(formatFunctionSignature('list_docs', [], undefined));
    expect(signature).toBe('function list_docs();');
  });
});

describe('formatCallExpressionExample', () => {
  it('uses example literals when provided and falls back for ids', () => {
    const example = formatCallExpressionExample('linear', 'create_issue', [
      baseOption({ property: 'title', required: true, exampleValue: 'Bug' }),
      baseOption({ property: 'teamId', required: true }),
      baseOption({ property: 'parentId', required: false }),
    ]);
    expect(example).toBe('mcporter call linear.create_issue(title: "Bug", teamId: "example-id")');
  });
});

describe('buildToolDoc', () => {
  it('produces reusable doc blocks and summaries', () => {
    const options = [
      baseOption({ property: 'issueId', description: 'Issue identifier', required: true }),
      baseOption({ property: 'body', description: 'Markdown body', required: true }),
      baseOption({ property: 'parentId', description: 'Optional parent', required: false }),
    ];
    const doc = buildToolDoc({
      serverName: 'linear',
      toolName: 'create_comment',
      description: 'Create a comment',
      outputSchema: { title: 'Comment' },
      options,
      requiredOnly: true,
      colorize: false,
    });
    expect(doc.signature).toBe('function create_comment(issueId: string, body: string, parentId?: string): Comment;');
    expect(doc.tsSignature).toBe('function create_comment(issueId: string, body: string, parentId?: string): Comment;');
    expect(doc.optionalSummary).toBeUndefined();
    expect(doc.examples[0]).toContain('mcporter call linear.create_comment');
    expect(doc.hiddenOptions).toHaveLength(0);
  });
});

function stripAnsi(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\u001B') {
      index += 1;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      continue;
    }
    result += char;
  }
  return result;
}
