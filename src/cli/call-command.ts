import { createCallResult } from '../result-utils.js';
import { parseCallExpressionFragment } from './call-expression-parser.js';
import { type OutputFormat, printCallOutput, tailLogIfRequested } from './output-utils.js';
import { dumpActiveHandles } from './runtime-debug.js';
import { dimText } from './terminal.js';
import { resolveCallTimeout, withTimeout } from './timeouts.js';

interface CallArgsParseResult {
  selector?: string;
  server?: string;
  tool?: string;
  args: Record<string, unknown>;
  tailLog: boolean;
  output: OutputFormat;
  timeoutMs?: number;
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === 'auto' || value === 'text' || value === 'markdown' || value === 'json' || value === 'raw';
}

export function parseCallArguments(args: string[]): CallArgsParseResult {
  // Maintain backwards compatibility with legacy positional + key=value forms.
  const result: CallArgsParseResult = { args: {}, tailLog: false, output: 'auto' };
  const positional: string[] = [];
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (!token) {
      index += 1;
      continue;
    }
    if (token === '--server' || token === '--mcp') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Flag '${token}' requires a value.`);
      }
      result.server = value;
      index += 2;
      continue;
    }
    if (token === '--tool') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Flag '${token}' requires a value.`);
      }
      result.tool = value;
      index += 2;
      continue;
    }
    if (token === '--timeout') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--timeout requires a value (milliseconds).');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--timeout must be a positive integer (milliseconds).');
      }
      result.timeoutMs = parsed;
      index += 2;
      continue;
    }
    if (token === '--tail-log') {
      result.tailLog = true;
      index += 1;
      continue;
    }
    if (token === '--args') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--args requires a JSON value.');
      }
      try {
        const decoded = JSON.parse(value);
        if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
          throw new Error('--args must be a JSON object.');
        }
        Object.assign(result.args, decoded);
      } catch (error) {
        throw new Error(`Unable to parse --args: ${(error as Error).message}`);
      }
      index += 2;
      continue;
    }
    if (token === '--output') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--output requires a format (auto|text|markdown|json|raw).');
      }
      if (!isOutputFormat(value)) {
        throw new Error('--output format must be one of: auto, text, markdown, json, raw.');
      }
      result.output = value;
      index += 2;
      continue;
    }
    positional.push(token);
    index += 1;
  }

  if (positional.length > 0) {
    const callExpression = parseCallExpressionFragment(positional[0] ?? '');
    if (callExpression) {
      positional.shift();
      if (callExpression.server) {
        if (result.server && result.server !== callExpression.server) {
          throw new Error(
            `Conflicting server names: '${result.server}' from flags and '${callExpression.server}' from call expression.`
          );
        }
        result.server = result.server ?? callExpression.server;
      }
      if (result.tool && result.tool !== callExpression.tool) {
        throw new Error(
          `Conflicting tool names: '${result.tool}' from flags and '${callExpression.tool}' from call expression.`
        );
      }
      result.tool = callExpression.tool;
      Object.assign(result.args, callExpression.args);
    }
  }

  if (!result.selector && positional.length > 0) {
    result.selector = positional.shift();
  }

  const nextPositional = positional[0];
  if (!result.tool && nextPositional !== undefined && !nextPositional.includes('=')) {
    result.tool = positional.shift();
  }

  for (const token of positional) {
    const [key, raw] = token.split('=', 2);
    if (!key || raw === undefined) {
      throw new Error(`Argument '${token}' must be key=value format.`);
    }
    const value = coerceValue(raw);
    if ((key === 'tool' || key === 'command') && !result.tool) {
      if (typeof value !== 'string') {
        throw new Error("Argument 'tool' must be a string value.");
      }
      result.tool = value as string;
      continue;
    }
    if (key === 'server' && !result.server) {
      if (typeof value !== 'string') {
        throw new Error("Argument 'server' must be a string value.");
      }
      result.server = value as string;
      continue;
    }
    result.args[key] = value;
  }
  return result;
}

export async function handleCall(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  args: string[]
): Promise<void> {
  const parsed = parseCallArguments(args);
  const { server, tool } = resolveCallTarget(parsed);

  const timeoutMs = resolveCallTimeout(parsed.timeoutMs);
  const { result } = await invokeWithAutoCorrection(runtime, server, tool, parsed.args, timeoutMs);

  const wrapped = createCallResult(result);
  printCallOutput(wrapped, result, parsed.output);
  tailLogIfRequested(result, parsed.tailLog);
  dumpActiveHandles('after call (formatted result)');
}

function resolveCallTarget(parsed: CallArgsParseResult): { server: string; tool: string } {
  const selector = parsed.selector;
  let server = parsed.server;
  let tool = parsed.tool;

  if (selector && !server && selector.includes('.')) {
    const [left, right] = selector.split('.', 2);
    server = left;
    tool = right;
  } else if (selector && !server) {
    server = selector;
  } else if (selector && !tool) {
    tool = selector;
  }

  if (!server) {
    throw new Error('Missing server name. Provide it via <server>.<tool> or --server.');
  }
  if (!tool) {
    throw new Error('Missing tool name. Provide it via <server>.<tool> or --tool.');
  }

  return { server, tool };
}

function coerceValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed === 'true';
  }
  if (trimmed === 'null' || trimmed === 'none') {
    return null;
  }
  if (!Number.isNaN(Number(trimmed)) && trimmed === `${Number(trimmed)}`) {
    return Number(trimmed);
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

type ToolResolution = { kind: 'auto-correct'; tool: string } | { kind: 'suggest'; tool: string };

async function invokeWithAutoCorrection(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<{ result: unknown; resolvedTool: string }> {
  // Attempt the original request first; if it fails with a "tool not found" we opportunistically retry once with a better match.
  return attemptCall(runtime, server, tool, args, timeoutMs, true);
}

async function attemptCall(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  allowCorrection: boolean
): Promise<{ result: unknown; resolvedTool: string }> {
  try {
    const result = await withTimeout(runtime.callTool(server, tool, { args }), timeoutMs);
    return { result, resolvedTool: tool };
  } catch (error) {
    if (error instanceof Error && error.message === 'Timeout') {
      const timeoutDisplay = `${timeoutMs}ms`;
      await runtime.close(server).catch(() => {});
      throw new Error(
        `Call to ${server}.${tool} timed out after ${timeoutDisplay}. Override MCPORTER_CALL_TIMEOUT or pass --timeout to adjust.`
      );
    }

    if (!allowCorrection) {
      throw error;
    }

    const resolution = await maybeResolveToolName(runtime, server, tool, error);
    if (!resolution) {
      throw error;
    }

    if (resolution.kind === 'suggest') {
      // Provide a hint without mutating the call; this keeps surprising edits out of the request while teaching the right name.
      console.error(dimText(`[mcporter] Did you mean ${server}.${resolution.tool}?`));
      throw error;
    }

    // Let the user know we silently retried with the canonical tool so they learn the proper name for next time.
    console.log(dimText(`[mcporter] Auto-corrected tool call to ${server}.${resolution.tool} (input: ${tool}).`));
    return attemptCall(runtime, server, resolution.tool, args, timeoutMs, false);
  }
}

async function maybeResolveToolName(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  server: string,
  attemptedTool: string,
  error: unknown
): Promise<ToolResolution | undefined> {
  const missingName = extractMissingToolFromError(error);
  if (!missingName) {
    return undefined;
  }

  // Only attempt a suggestion if the server explicitly rejected the tool we tried.
  if (normalizeToolName(missingName) !== normalizeToolName(attemptedTool)) {
    return undefined;
  }

  const tools = await runtime.listTools(server).catch(() => undefined);
  if (!tools) {
    return undefined;
  }

  return chooseClosestToolName(
    attemptedTool,
    tools.map((entry) => entry.name)
  );
}

function extractMissingToolFromError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (!message) {
    return undefined;
  }
  const match = message.match(/Tool\s+([A-Za-z0-9._-]+)\s+not found/i);
  return match?.[1];
}

function chooseClosestToolName(attempted: string, candidates: string[]): ToolResolution | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const normalizedAttempt = normalizeToolName(attempted);
  let bestName: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === attempted) {
      continue;
    }

    const normalizedCandidate = normalizeToolName(candidate);

    if (normalizedCandidate === normalizedAttempt) {
      return { kind: 'auto-correct', tool: candidate };
    }

    if (candidate.toLowerCase() === attempted.toLowerCase()) {
      return { kind: 'auto-correct', tool: candidate };
    }

    const score = levenshtein(normalizedAttempt, normalizedCandidate);
    if (score < bestScore) {
      bestScore = score;
      bestName = candidate;
    }
  }

  if (bestName === undefined) {
    return undefined;
  }

  const lengthBaseline = Math.max(normalizedAttempt.length, normalizeToolName(bestName).length, 1);
  // Require a reasonably low edit distance so we avoid "helpful" corrections that would surprise the caller.
  const threshold = Math.max(2, Math.floor(lengthBaseline * 0.3));
  if (bestScore <= threshold) {
    return { kind: 'auto-correct', tool: bestName };
  }
  return { kind: 'suggest', tool: bestName };
}

function normalizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = Array.from<number, number>({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const charA = a[i - 1];
    for (let j = 1; j <= b.length; j += 1) {
      const insertSource = current[j - 1];
      const deleteSource = previous[j];
      const replaceSource = previous[j - 1];
      const insertCost = insertSource === undefined ? Number.POSITIVE_INFINITY : insertSource + 1;
      const deleteCost = deleteSource === undefined ? Number.POSITIVE_INFINITY : deleteSource + 1;
      const replaceCost =
        (replaceSource === undefined ? Number.POSITIVE_INFINITY : replaceSource) + (charA === b[j - 1] ? 0 : 1);
      current[j] = Math.min(insertCost, deleteCost, replaceCost);
    }
    [previous, current] = [current, previous];
  }

  const finalValue = previous[b.length];
  return finalValue === undefined ? Number.POSITIVE_INFINITY : finalValue;
}
