import type { GeneratedOption } from './generate/tools.js';
import { cyanText, dimText, extraDimText, yellowText } from './terminal.js';

export interface SelectDisplayOptionsResult {
  displayOptions: GeneratedOption[];
  hiddenOptions: GeneratedOption[];
}

export interface ToolDocInput {
  serverName: string;
  toolName: string;
  description?: string;
  outputSchema?: unknown;
  options: GeneratedOption[];
  requiredOnly: boolean;
  colorize?: boolean;
  exampleMaxLength?: number;
}

export interface ToolDocModel {
  docLines?: string[];
  signature: string;
  tsSignature: string;
  optionalSummary?: string;
  examples: string[];
  displayOptions: GeneratedOption[];
  hiddenOptions: GeneratedOption[];
}

const DEFAULT_MIN_VISIBLE_PARAMS = 5;
const DEFAULT_WRAP_WIDTH = 100;

export function selectDisplayOptions(
  options: GeneratedOption[],
  requiredOnly: boolean,
  minVisible = DEFAULT_MIN_VISIBLE_PARAMS
): SelectDisplayOptionsResult {
  if (!requiredOnly || options.length <= minVisible) {
    return { displayOptions: options, hiddenOptions: [] };
  }
  const included = new Set<number>();
  options.forEach((option, index) => {
    if (option.required) {
      included.add(index);
    }
  });
  let includedCount = included.size;
  if (includedCount < minVisible) {
    for (let index = 0; index < options.length && includedCount < minVisible; index += 1) {
      if (included.has(index)) {
        continue;
      }
      included.add(index);
      includedCount += 1;
    }
  }
  const displayOptions = options.filter((_option, index) => included.has(index));
  const hiddenOptions = options.filter((_option, index) => !included.has(index));
  return { displayOptions, hiddenOptions };
}

export function buildDocComment(
  description: string | undefined,
  options: GeneratedOption[],
  opts?: { colorize?: boolean }
): string[] | undefined {
  const colorize = opts?.colorize !== false;
  const descriptionLines = description?.split(/\r?\n/) ?? [];
  const paramDocs = options.filter((option) => option.description);
  if (descriptionLines.every((line) => line.trim().length === 0) && paramDocs.length === 0) {
    return undefined;
  }
  const tint = colorize ? extraDimText : (value: string): string => value;
  const highlightParam = colorize ? (value: string): string => yellowText(value) : (value: string): string => value;
  const highlightName = colorize ? (value: string): string => cyanText(value) : (value: string): string => value;
  const lines: string[] = [];
  lines.push(tint('/**'));
  let hasDescription = false;
  for (const line of descriptionLines) {
    const trimmed = line.trimEnd();
    if (trimmed.trim().length > 0) {
      const wrapped = wrapCommentText(trimmed);
      for (const segment of wrapped) {
        lines.push(tint(` * ${segment}`));
      }
      hasDescription = true;
    }
  }
  if (hasDescription && paramDocs.length > 0) {
    lines.push(tint(' *'));
  }
  for (const option of paramDocs) {
    const optionLines = formatParamDoc(option, DEFAULT_WRAP_WIDTH, {
      colorize,
      highlightParam,
      highlightName,
      tint,
    });
    lines.push(...optionLines);
  }
  lines.push(tint(' */'));
  return lines;
}

function formatParamDoc(
  option: GeneratedOption,
  wrapWidth: number,
  formatting: {
    colorize: boolean;
    highlightParam: (value: string) => string;
    highlightName: (value: string) => string;
    tint: (value: string) => string;
  }
): string[] {
  const { colorize, highlightParam, highlightName, tint } = formatting;
  const descriptionLines = option.description?.split(/\r?\n/) ?? [''];
  const optionalSuffix = option.required ? '' : '?';
  const plainLabel = `@param ${option.property}${optionalSuffix}`;
  const continuationPrefix = colorize
    ? extraDimText(` * ${' '.repeat(plainLabel.length + 1)}`)
    : ` * ${' '.repeat(plainLabel.length + 1)}`;
  const rendered: string[] = [];
  descriptionLines.forEach((entry, index) => {
    const suffix = entry.trimEnd();
    if (index === 0) {
      const lineParts = [colorize ? extraDimText(' * ') : ' * ', highlightParam('@param '), highlightName(`${option.property}${optionalSuffix}`)];
      if (suffix.length > 0) {
        const wrapped = wrapCommentText(suffix, wrapWidth - plainLabel.length - 1);
        if (wrapped.length > 0) {
          lineParts.push(colorize ? extraDimText(` ${wrapped[0]}`) : ` ${wrapped[0]}`);
          rendered.push(lineParts.join(''));
          for (const continuation of wrapped.slice(1)) {
            rendered.push(`${continuationPrefix}${colorize ? extraDimText(continuation) : continuation}`);
          }
          return;
        }
      }
      rendered.push(lineParts.join(''));
      return;
    }
    if (suffix.length > 0) {
      const wrapped = wrapCommentText(suffix, wrapWidth - plainLabel.length - 1);
      if (wrapped.length === 0) {
        return;
      }
      const [first, ...rest] = wrapped;
      if (!first) {
        return;
      }
      rendered.push(`${continuationPrefix}${colorize ? extraDimText(first) : first}`);
      for (const segment of rest) {
        rendered.push(`${continuationPrefix}${colorize ? extraDimText(segment) : segment}`);
      }
    }
  });
  return rendered;
}

export function formatOptionalSummary(hiddenOptions: GeneratedOption[], options?: { colorize?: boolean }): string {
  const colorize = options?.colorize !== false;
  const maxNames = 5;
  const names = hiddenOptions.map((option) => option.property);
  if (names.length === 0) {
    return '';
  }
  const preview = names.slice(0, maxNames).join(', ');
  const suffix = names.length > maxNames ? ', ...' : '';
  const tint = colorize ? extraDimText : (value: string): string => value;
  return tint(`// optional (${names.length}): ${preview}${suffix}`);
}

interface SignatureFormatOptions {
  colorize?: boolean;
}

export function formatFunctionSignature(
  name: string,
  options: GeneratedOption[],
  outputSchema: unknown,
  formatOptions?: SignatureFormatOptions
): string {
  const colorize = formatOptions?.colorize !== false;
  const keyword = colorize ? extraDimText('function') : 'function';
  const formattedName = colorize ? cyanText(name) : name;
  const paramsText = options.map((option) => formatInlineParameter(option, colorize)).join(', ');
  const returnType = inferReturnTypeName(outputSchema);
  const signature = `${keyword} ${formattedName}(${paramsText})`;
  return returnType ? `${signature}: ${returnType};` : `${signature};`;
}

export function formatCallExpressionExample(
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

export function formatExampleBlock(
  examples: string[],
  options?: { maxExamples?: number; maxLength?: number }
): string[] {
  // Keep examples deterministic: dedupe, cap the total, then apply the same ellipsis logic
  // used by the list command so generators/CLIs display identical call hints.
  const maxExamples = options?.maxExamples ?? 1;
  const maxLength = options?.maxLength ?? 80;
  return Array.from(new Set(examples))
    .filter(Boolean)
    .slice(0, maxExamples)
    .map((example) => truncateExample(example, maxLength));
}

export function wrapCommentText(text: string, maxWidth = DEFAULT_WRAP_WIDTH): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const lines: string[] = [];
  let current = words[0] ?? '';
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (!word) {
      continue;
    }
    if (`${current} ${word}`.length > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  lines.push(current);
  return lines;
}

function truncateExample(example: string, maxLength: number): string {
  if (example.length <= maxLength) {
    return example;
  }
  const openIndex = example.indexOf('(');
  const closeIndex = example.lastIndexOf(')');
  if (openIndex === -1 || closeIndex === -1 || closeIndex <= openIndex) {
    return `${example.slice(0, Math.max(0, maxLength - 1))}…`;
  }
  const prefix = example.slice(0, openIndex + 1);
  const suffix = example.slice(closeIndex);
  const available = maxLength - prefix.length - suffix.length - 5; // room for ', ...'
  if (available <= 0) {
    return `${prefix}...${suffix}`;
  }
  const args = example.slice(openIndex + 1, closeIndex).trim();
  const shortened = args.slice(0, available).trimEnd().replace(/[\s,]+$/, '');
  const ellipsis = shortened.length > 0 ? `${shortened}, ...` : '...';
  return `${prefix}${ellipsis}${suffix}`;
}

export function buildToolDoc(input: ToolDocInput): ToolDocModel {
  const {
    serverName,
    toolName,
    description,
    outputSchema,
    options,
    requiredOnly,
    colorize = true,
    exampleMaxLength,
  } = input;
  const { displayOptions, hiddenOptions } = selectDisplayOptions(options, requiredOnly);
  const docLines = buildDocComment(description, options, { colorize });
  const signature = formatFunctionSignature(toolName, displayOptions, outputSchema, { colorize });
  const tsSignature = formatFunctionSignature(toolName, displayOptions, outputSchema, { colorize: false });
  const optionalSummary = hiddenOptions.length > 0 ? formatOptionalSummary(hiddenOptions, { colorize }) : undefined;
  const callExample = formatCallExpressionExample(
    serverName,
    toolName,
    displayOptions.length > 0 ? displayOptions : options
  );
  const examples = callExample
    ? formatExampleBlock([callExample], { maxExamples: 1, maxLength: exampleMaxLength ?? 80 })
    : [];
  return {
    docLines,
    signature,
    tsSignature,
    optionalSummary,
    examples,
    displayOptions,
    hiddenOptions,
  };
}

function formatInlineParameter(option: GeneratedOption, colorize: boolean): string {
  const typeAnnotation = formatTypeAnnotation(option, colorize);
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

function formatTypeAnnotation(option: GeneratedOption, colorize: boolean): string {
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
  const tint = colorize ? dimText : (value: string): string => value;
  const base = tint(baseType);
  if (option.formatHint && option.type === 'string' && (!option.enumValues || option.enumValues.length === 0)) {
    const descriptionText = option.description?.toLowerCase() ?? '';
    const hintLower = option.formatHint.toLowerCase();
    const normalizedDescription = descriptionText.replace(/[\s_-]+/g, '');
    const normalizedHint = hintLower.replace(/[\s_-]+/g, '');
    const hasHintInDescription = descriptionText.includes(hintLower) || normalizedDescription.includes(normalizedHint);
    if (hasHintInDescription) {
      return base;
    }
    return `${base} ${tint(`/* ${option.formatHint} */`)}`;
  }
  return base;
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
