import ora from 'ora';
import type { ServerDefinition } from '../config.js';
import type { ServerToolInfo } from '../runtime.js';
import { type EphemeralServerSpec, persistEphemeralServer, resolveEphemeralServer } from './adhoc-server.js';
import type { GeneratedOption } from './generate/tools.js';
import { extractOptions } from './generate/tools.js';
import { chooseClosestIdentifier } from './identifier-helpers.js';
import { buildDocComment, formatOptionalSummary, selectDisplayOptions } from './list-detail-helpers.js';
import type { ListSummaryResult, StatusCategory } from './list-format.js';
import { formatSourceSuffix, renderServerListRow } from './list-format.js';
import { boldText, cyanText, dimText, extraDimText, supportsSpinner, yellowText } from './terminal.js';
import { LIST_TIMEOUT_MS, withTimeout } from './timeouts.js';

export function extractListFlags(args: string[]): {
  schema: boolean;
  timeoutMs?: number;
  requiredOnly: boolean;
  ephemeral?: EphemeralServerSpec;
} {
  let schema = false;
  let timeoutMs: number | undefined;
  let requiredOnly = true;
  let ephemeral: EphemeralServerSpec | undefined;
  let index = 0;
  const ensureEphemeral = (): EphemeralServerSpec => {
    if (!ephemeral) {
      ephemeral = {};
    }
    return ephemeral;
  };
  while (index < args.length) {
    const token = args[index];
    if (token === '--schema') {
      schema = true;
      args.splice(index, 1);
      continue;
    }
    if (token === '--http-url') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--http-url' requires a value.");
      }
      ensureEphemeral().httpUrl = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--allow-http') {
      ensureEphemeral().allowInsecureHttp = true;
      args.splice(index, 1);
      continue;
    }
    if (token === '--stdio') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--stdio' requires a value.");
      }
      ensureEphemeral().stdioCommand = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--stdio-arg') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--stdio-arg' requires a value.");
      }
      const spec = ensureEphemeral();
      spec.stdioArgs = [...(spec.stdioArgs ?? []), value];
      args.splice(index, 2);
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
      const spec = ensureEphemeral();
      const envMap = spec.env ? { ...spec.env } : {};
      envMap[key] = rest.join('=');
      spec.env = envMap;
      args.splice(index, 2);
      continue;
    }
    if (token === '--cwd') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--cwd' requires a value.");
      }
      ensureEphemeral().cwd = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--name') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--name' requires a value.");
      }
      ensureEphemeral().name = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--description') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--description' requires a value.");
      }
      ensureEphemeral().description = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--persist') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--persist' requires a value.");
      }
      ensureEphemeral().persistPath = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--yes') {
      args.splice(index, 1);
      continue;
    }
    if (token === '--all-parameters') {
      requiredOnly = false;
      args.splice(index, 1);
      continue;
    }
    if (token === '--timeout') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--timeout' requires a value.");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--timeout must be a positive integer (milliseconds).');
      }
      timeoutMs = parsed;
      args.splice(index, 2);
      continue;
    }
    index += 1;
  }
  return { schema, timeoutMs, requiredOnly, ephemeral };
}

export async function handleList(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  args: string[]
): Promise<void> {
  const flags = extractListFlags(args);
  let target = args.shift();
  let ephemeralResolution: ReturnType<typeof resolveEphemeralServer> | undefined;

  if (!flags.ephemeral && target && /^https?:\/\//i.test(target)) {
    flags.ephemeral = { httpUrl: target };
    target = undefined;
  }

  if (flags.ephemeral) {
    ephemeralResolution = resolveEphemeralServer(flags.ephemeral);
    runtime.registerDefinition(ephemeralResolution.definition, { overwrite: true });
    if (flags.ephemeral.persistPath) {
      await persistEphemeralServer(ephemeralResolution, flags.ephemeral.persistPath);
    }
    if (!target) {
      target = ephemeralResolution.name;
    }
  }

  if (!target) {
    const servers = runtime.getDefinitions();
    const perServerTimeoutMs = flags.timeoutMs ?? LIST_TIMEOUT_MS;
    const perServerTimeoutSeconds = Math.round(perServerTimeoutMs / 1000);

    if (servers.length === 0) {
      console.log('No MCP servers configured.');
      return;
    }

    console.log(`Listing ${servers.length} server(s) (per-server timeout: ${perServerTimeoutSeconds}s)`);
    const spinner = supportsSpinner ? ora(`Discovering ${servers.length} server(s)…`).start() : undefined;
    const spinnerActive = Boolean(spinner);
    // Track rendered rows separately so we can show live progress yet still build an ordered footer summary afterward.
    const renderedResults: Array<ReturnType<typeof renderServerListRow> | undefined> = Array.from(
      { length: servers.length },
      () => undefined
    );
    let completedCount = 0;

    // Kick off every list request up-front so slow servers don't block faster ones.
    const tasks = servers.map((server, index) =>
      (async (): Promise<ListSummaryResult> => {
        const startedAt = Date.now();
        try {
          // autoAuthorize=false keeps the list command purely observational—no auth prompts mid-run.
          const tools = await withTimeout(runtime.listTools(server.name, { autoAuthorize: false }), perServerTimeoutMs);
          return {
            server,
            status: 'ok' as const,
            tools,
            durationMs: Date.now() - startedAt,
          };
        } catch (error) {
          return {
            server,
            status: 'error' as const,
            error,
            durationMs: Date.now() - startedAt,
          };
        }
      })().then((result) => {
        const rendered = renderServerListRow(result, perServerTimeoutMs);
        // Persist results in the original index so the final summary prints in config order, even though tasks resolve out of order.
        renderedResults[index] = rendered;
        completedCount += 1;

        if (spinnerActive && spinner) {
          spinner.stop();
          console.log(rendered.line);
          const remaining = servers.length - completedCount;
          if (remaining > 0) {
            // Switch the spinner to a count-only message so we avoid re-printing the last server name over and over.
            spinner.text = `Listing servers… ${completedCount}/${servers.length}`;
            spinner.start();
          }
        } else {
          console.log(rendered.line);
        }

        return result;
      })
    );

    await Promise.all(tasks);

    const errorCounts: Record<StatusCategory, number> = {
      ok: 0,
      auth: 0,
      offline: 0,
      error: 0,
    };
    renderedResults.forEach((entry) => {
      if (!entry) {
        return;
      }
      // Default anything unexpected to the error bucket so the footer still surfaces that something went wrong.
      const category = (entry as { category?: StatusCategory }).category ?? 'error';
      errorCounts[category] = (errorCounts[category] ?? 0) + 1;
    });
    if (spinnerActive && spinner) {
      spinner.stop();
    }
    const okSummary = `${errorCounts.ok} healthy`;
    const parts = [
      okSummary,
      ...(errorCounts.auth > 0 ? [`${errorCounts.auth} auth required`] : []),
      ...(errorCounts.offline > 0 ? [`${errorCounts.offline} offline`] : []),
      ...(errorCounts.error > 0 ? [`${errorCounts.error} errors`] : []),
    ];
    console.log(`✔ Listed ${servers.length} server${servers.length === 1 ? '' : 's'} (${parts.join('; ')}).`);
    return;
  }

  const resolved = resolveServerDefinition(runtime, target);
  if (!resolved) {
    return;
  }
  target = resolved.name;
  const definition = resolved.definition;
  const timeoutMs = flags.timeoutMs ?? LIST_TIMEOUT_MS;
  const sourcePath =
    definition.source?.kind === 'import' || definition.source?.kind === 'local'
      ? formatSourceSuffix(definition.source, true)
      : undefined;
  const transportSummary =
    definition.command.kind === 'http'
      ? `HTTP ${definition.command.url instanceof URL ? definition.command.url.href : String(definition.command.url)}`
      : `STDIO ${[definition.command.command, ...(definition.command.args ?? [])].join(' ')}`.trim();
  const startedAt = Date.now();
  try {
    // Always request schemas so we can render CLI-style parameter hints without re-querying per tool.
    const tools = await withTimeout(runtime.listTools(target, { includeSchema: true }), timeoutMs);
    const durationMs = Date.now() - startedAt;
    const summaryLine = printSingleServerHeader(definition, tools.length, durationMs, transportSummary, sourcePath, {
      printSummaryNow: false,
    });
    if (tools.length === 0) {
      console.log('  Tools: <none>');
      console.log(summaryLine);
      console.log('');
      return;
    }
    const examples: string[] = [];
    let optionalOmitted = false;
    for (const tool of tools) {
      const detail = printToolDetail(target, tool, Boolean(flags.schema), flags.requiredOnly);
      if (detail.example) {
        examples.push(detail.example);
      }
      optionalOmitted ||= detail.optionalOmitted;
    }
    const uniqueExamples = Array.from(new Set(examples)).filter(Boolean).slice(0, 3);
    if (uniqueExamples.length > 0) {
      console.log(`  ${dimText('Examples:')}`);
      for (const example of uniqueExamples) {
        console.log(`    ${example}`);
      }
      console.log('');
    }
    if (flags.requiredOnly && optionalOmitted) {
      console.log(`  ${extraDimText('Optional parameters hidden; run with --all-parameters to view all fields.')}`);
      console.log('');
    }
    console.log(summaryLine);
    console.log('');
    return;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    printSingleServerHeader(definition, undefined, durationMs, transportSummary, sourcePath);
    const message = error instanceof Error ? error.message : 'Failed to load tool list.';
    const timeoutMs = flags.timeoutMs ?? LIST_TIMEOUT_MS;
    console.warn(`  Tools: <timed out after ${timeoutMs}ms>`);
    console.warn(`  Reason: ${message}`);
  }
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

interface ToolDetailResult {
  example?: string;
  optionalOmitted: boolean;
}

function printSingleServerHeader(
  definition: ReturnType<Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>['getDefinition']>,
  toolCount: number | undefined,
  durationMs: number | undefined,
  transportSummary: string,
  sourcePath: string | undefined,
  options?: { printSummaryNow?: boolean }
): string {
  const prefix = boldText(definition.name);
  if (definition.description) {
    console.log(`${prefix} - ${extraDimText(definition.description)}`);
  } else {
    console.log(prefix);
  }
  const summaryParts: string[] = [];
  summaryParts.push(
    extraDimText(typeof toolCount === 'number' ? `${toolCount} tool${toolCount === 1 ? '' : 's'}` : 'tools unavailable')
  );
  if (typeof durationMs === 'number') {
    summaryParts.push(extraDimText(`${durationMs}ms`));
  }
  if (transportSummary) {
    summaryParts.push(extraDimText(transportSummary));
  }
  if (sourcePath) {
    summaryParts.push(sourcePath);
  }
  const summaryLine = `  ${summaryParts.join(extraDimText(' · '))}`;
  if (options?.printSummaryNow === false) {
    console.log('');
  } else {
    console.log(summaryLine);
    console.log('');
  }
  return summaryLine;
}

function printToolDetail(
  serverName: string,
  tool: { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown },
  includeSchema: boolean,
  requiredOnly: boolean
): ToolDetailResult {
  const options = extractOptions(tool as ServerToolInfo);
  const { displayOptions, hiddenOptions } = selectDisplayOptions(options, requiredOnly);
  const docLines = buildDocComment(tool.description, options);
  if (docLines) {
    for (const line of docLines) {
      console.log(`  ${line}`);
    }
  }
  console.log(`  ${formatFunctionSignature(tool.name, displayOptions, tool.outputSchema)}`);
  if (hiddenOptions.length > 0 && requiredOnly) {
    console.log(`  ${formatOptionalSummary(hiddenOptions)}`);
  }

  if (includeSchema && tool.inputSchema) {
    // Schemas can be large — indenting keeps multi-line JSON legible without disrupting surrounding output.
    console.log(indent(JSON.stringify(tool.inputSchema, null, 2), '      '));
  }
  console.log('');
  return {
    example: formatCallExpressionExample(serverName, tool.name, displayOptions.length > 0 ? displayOptions : options),
    optionalOmitted: hiddenOptions.length > 0,
  };
}

function formatFunctionSignature(name: string, options: GeneratedOption[], outputSchema: unknown): string {
  const paramsText = options.map(formatInlineParameter).join(', ');
  const returnType = inferReturnTypeName(outputSchema);
  const keyword = extraDimText('function');
  const signature = `${keyword} ${cyanText(name)}(${paramsText})`;
  return returnType ? `${signature}: ${returnType};` : `${signature};`;
}

function formatInlineParameter(option: GeneratedOption): string {
  const typeAnnotation = formatTypeAnnotation(option);
  const optionalSuffix = option.required ? '' : '?';
  return `${option.property}${optionalSuffix}: ${typeAnnotation}`;
}

function inferReturnTypeName(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  return inferSchemaDisplayType(schema as Record<string, unknown>);
}

function inferSchemaDisplayType(descriptor: Record<string, unknown>): string {
  const title = typeof descriptor.title === 'string' ? descriptor.title.trim() : undefined;
  if (title) {
    return title;
  }
  const type = typeof descriptor.type === 'string' ? (descriptor.type as string) : undefined;
  if (!type && typeof descriptor.properties === 'object') {
    return 'object';
  }
  if (!type && descriptor.items && typeof descriptor.items === 'object') {
    return `${inferSchemaDisplayType(descriptor.items as Record<string, unknown>)}[]`;
  }
  if (type === 'array' && descriptor.items && typeof descriptor.items === 'object') {
    return `${inferSchemaDisplayType(descriptor.items as Record<string, unknown>)}[]`;
  }
  if (!type && Array.isArray(descriptor.enum)) {
    const values = (descriptor.enum as unknown[]).filter((entry): entry is string => typeof entry === 'string');
    if (values.length > 0) {
      return values.map((entry) => JSON.stringify(entry)).join(' | ');
    }
  }
  return type ?? 'unknown';
}

function formatTypeAnnotation(option: GeneratedOption): string {
  let baseType: string;
  if (option.enumValues && option.enumValues.length > 0) {
    baseType = option.enumValues.map((value) => JSON.stringify(value)).join(' | ');
  } else {
    switch (option.type) {
      case 'number':
        baseType = 'number';
        break;
      case 'boolean':
        baseType = 'boolean';
        break;
      case 'array':
        baseType = 'string[]';
        break;
      case 'string':
        baseType = 'string';
        break;
      default:
        baseType = 'unknown';
        break;
    }
  }
  const dimmedType = dimText(baseType);
  if (option.formatHint && option.type === 'string' && (!option.enumValues || option.enumValues.length === 0)) {
    const descriptionText = option.description?.toLowerCase() ?? '';
    const hintLower = option.formatHint.toLowerCase();
    const normalizedDescription = descriptionText.replace(/[\s_-]+/g, '');
    const normalizedHint = hintLower.replace(/[\s_-]+/g, '');
    const hasHintInDescription = descriptionText.includes(hintLower) || normalizedDescription.includes(normalizedHint);
    if (hasHintInDescription) {
      return dimmedType;
    }
    return `${dimmedType} ${dimText(`/* ${option.formatHint} */`)}`;
  }
  return dimmedType;
}

function resolveServerDefinition(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  name: string
): { definition: ServerDefinition; name: string } | undefined {
  try {
    const definition = runtime.getDefinition(name);
    return { definition, name };
  } catch (error) {
    if (!(error instanceof Error) || !/Unknown MCP server/i.test(error.message)) {
      throw error;
    }
    const suggestion = suggestServerName(runtime, name);
    if (!suggestion) {
      console.error(error.message);
      return undefined;
    }
    if (suggestion.kind === 'auto') {
      console.log(dimText(`[mcporter] Auto-corrected server name to ${suggestion.value} (input: ${name}).`));
      return resolveServerDefinition(runtime, suggestion.value);
    }
    console.error(yellowText(`[mcporter] Did you mean ${suggestion.value}?`));
    console.error(error.message);
    return undefined;
  }
}

function suggestServerName(
  runtime: Awaited<ReturnType<typeof import('../runtime.js')['createRuntime']>>,
  attempted: string
) {
  const definitions = runtime.getDefinitions();
  const names = definitions.map((entry) => entry.name);
  return chooseClosestIdentifier(attempted, names);
}

function formatCallExpressionExample(
  serverName: string,
  toolName: string,
  options: GeneratedOption[]
): string | undefined {
  const assignments = options
    .map((option) => ({ option, literal: buildExampleLiteral(option) }))
    .filter(({ option, literal }) => option.required || literal !== undefined)
    .map(({ option, literal }) => {
      const value = literal ?? buildFallbackLiteral(option);
      return `${option.property}: ${value}`;
    });

  const args = assignments.join(', ');
  const callSuffix = assignments.length > 0 ? `(${args})` : '()';
  return `mcporter call ${serverName}.${toolName}${callSuffix}`;
}

function buildExampleLiteral(option: GeneratedOption): string | undefined {
  if (option.enumValues && option.enumValues.length > 0) {
    return JSON.stringify(option.enumValues[0]);
  }
  if (!option.exampleValue) {
    return undefined;
  }
  if (option.type === 'array') {
    const values = option.exampleValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      return undefined;
    }
    return `[${values.map((entry) => JSON.stringify(entry)).join(', ')}]`;
  }
  if (option.type === 'number' || option.type === 'boolean') {
    return option.exampleValue;
  }
  try {
    const parsed = JSON.parse(option.exampleValue);
    if (typeof parsed === 'number' || typeof parsed === 'boolean') {
      return option.exampleValue;
    }
  } catch {
    // Ignore JSON parse errors; fall through to quote string values.
  }
  return JSON.stringify(option.exampleValue);
}

function buildFallbackLiteral(option: GeneratedOption): string {
  switch (option.type) {
    case 'number':
      return '1';
    case 'boolean':
      return 'true';
    case 'array':
      return '["value1"]';
    default: {
      if (option.property.toLowerCase().includes('id')) {
        return JSON.stringify('example-id');
      }
      if (option.property.toLowerCase().includes('url')) {
        return JSON.stringify('https://example.com');
      }
      return JSON.stringify('value');
    }
  }
}
