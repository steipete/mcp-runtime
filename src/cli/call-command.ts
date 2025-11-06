import { createCallResult } from '../result-utils.js';
import { type EphemeralServerSpec, persistEphemeralServer, resolveEphemeralServer } from './adhoc-server.js';
import { parseCallExpressionFragment } from './call-expression-parser.js';
import { chooseClosestIdentifier, normalizeIdentifier } from './identifier-helpers.js';
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
  ephemeral?: EphemeralServerSpec;
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === 'auto' || value === 'text' || value === 'markdown' || value === 'json' || value === 'raw';
}

export function parseCallArguments(args: string[]): CallArgsParseResult {
  // Maintain backwards compatibility with legacy positional + key=value forms.
  const result: CallArgsParseResult = { args: {}, tailLog: false, output: 'auto' };
  const positional: string[] = [];
  const ensureEphemeral = (): EphemeralServerSpec => {
    if (!result.ephemeral) {
      result.ephemeral = {};
    }
    return result.ephemeral;
  };
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
    if (token === '--http-url') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--http-url' requires a value.");
      }
      ensureEphemeral().httpUrl = value;
      index += 2;
      continue;
    }
    if (token === '--allow-http') {
      ensureEphemeral().allowInsecureHttp = true;
      index += 1;
      continue;
    }
    if (token === '--stdio') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--stdio' requires a value.");
      }
      ensureEphemeral().stdioCommand = value;
      index += 2;
      continue;
    }
    if (token === '--stdio-arg') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--stdio-arg' requires a value.");
      }
      const ephemeral = ensureEphemeral();
      ephemeral.stdioArgs = [...(ephemeral.stdioArgs ?? []), value];
      index += 2;
      continue;
    }
    if (token === '--env') {
      const value = args[index + 1];
      if (!value || !value.includes('=')) {
        throw new Error("Flag '--env' requires KEY=value.");
      }
      const [key, ...rest] = value.split('=');
      if (!key) {
        throw new Error("Flag '--env' requires KEY=value.");
      }
      const ephemeral = ensureEphemeral();
      const envMap = ephemeral.env ? { ...ephemeral.env } : {};
      envMap[key] = rest.join('=');
      ephemeral.env = envMap;
      index += 2;
      continue;
    }
    if (token === '--cwd') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--cwd' requires a value.");
      }
      ensureEphemeral().cwd = value;
      index += 2;
      continue;
    }
    if (token === '--name') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--name' requires a value.");
      }
      ensureEphemeral().name = value;
      index += 2;
      continue;
    }
    if (token === '--description') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--description' requires a value.");
      }
      ensureEphemeral().description = value;
      index += 2;
      continue;
    }
    if (token === '--persist') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--persist' requires a value.");
      }
      ensureEphemeral().persistPath = value;
      index += 2;
      continue;
    }
    if (token === '--yes') {
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
  let ephemeralSpec = parsed.ephemeral;
  if (!ephemeralSpec && parsed.server && looksLikeHttpUrl(parsed.server)) {
    ephemeralSpec = { httpUrl: parsed.server };
    parsed.server = undefined;
  }
  if (!ephemeralSpec && parsed.selector && looksLikeHttpUrl(parsed.selector)) {
    ephemeralSpec = { httpUrl: parsed.selector };
    parsed.selector = undefined;
  }
  if (ephemeralSpec && parsed.server && !looksLikeHttpUrl(parsed.server)) {
    ephemeralSpec = { ...ephemeralSpec, name: ephemeralSpec.name ?? parsed.server };
    parsed.server = undefined;
  }

  if (ephemeralSpec?.httpUrl && !ephemeralSpec.name && parsed.tool) {
    // Keep derived name stable when the user invoked <url>.<tool> by hinting the server segment from selector.
    const candidate = parsed.selector && !looksLikeHttpUrl(parsed.selector) ? parsed.selector : undefined;
    if (candidate) {
      ephemeralSpec = { ...ephemeralSpec, name: candidate };
      parsed.selector = undefined;
    }
  }

  let ephemeralResolution: ReturnType<typeof resolveEphemeralServer> | undefined;
  if (ephemeralSpec) {
    ephemeralResolution = resolveEphemeralServer(ephemeralSpec);
    runtime.registerDefinition(ephemeralResolution.definition, { overwrite: true });
    if (ephemeralSpec.persistPath) {
      await persistEphemeralServer(ephemeralResolution, ephemeralSpec.persistPath);
    }
    parsed.server = ephemeralResolution.name;
    if (!parsed.selector) {
      parsed.selector = ephemeralResolution.name;
    }
  }
  const { server, tool } = resolveCallTarget(parsed);

  const timeoutMs = resolveCallTimeout(parsed.timeoutMs);
  const { result } = await invokeWithAutoCorrection(runtime, server, tool, parsed.args, timeoutMs);

  const wrapped = createCallResult(result);
  printCallOutput(wrapped, result, parsed.output);
  tailLogIfRequested(result, parsed.tailLog);
  dumpActiveHandles('after call (formatted result)');
}

function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
  if (normalizeIdentifier(missingName) !== normalizeIdentifier(attemptedTool)) {
    return undefined;
  }

  const tools = await runtime.listTools(server).catch(() => undefined);
  if (!tools) {
    return undefined;
  }

  const resolution = chooseClosestIdentifier(
    attemptedTool,
    tools.map((entry) => entry.name)
  );
  if (!resolution) {
    return undefined;
  }
  if (resolution.kind === 'auto') {
    return { kind: 'auto-correct', tool: resolution.value };
  }
  return { kind: 'suggest', tool: resolution.value };
}

function extractMissingToolFromError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (!message) {
    return undefined;
  }
  const match = message.match(/Tool\s+([A-Za-z0-9._-]+)\s+not found/i);
  return match?.[1];
}
