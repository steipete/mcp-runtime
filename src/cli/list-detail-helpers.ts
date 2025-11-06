import type { GeneratedOption } from './generate/tools.js';
import { cyanText, extraDimText, yellowText } from './terminal.js';

export interface SelectDisplayOptionsResult {
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

export function buildDocComment(description: string | undefined, options: GeneratedOption[]): string[] | undefined {
  const descriptionLines = description?.split(/\r?\n/) ?? [];
  const paramDocs = options.filter((option) => option.description);
  if (descriptionLines.every((line) => line.trim().length === 0) && paramDocs.length === 0) {
    return undefined;
  }
  const lines: string[] = [];
  lines.push(extraDimText('/**'));
  let hasDescription = false;
  for (const line of descriptionLines) {
    const trimmed = line.trimEnd();
    if (trimmed.trim().length > 0) {
      const wrapped = wrapCommentText(trimmed);
      for (const segment of wrapped) {
        lines.push(extraDimText(` * ${segment}`));
      }
      hasDescription = true;
    }
  }
  if (hasDescription && paramDocs.length > 0) {
    lines.push(extraDimText(' *'));
  }
  for (const option of paramDocs) {
    const optionLines = formatParamDoc(option, DEFAULT_WRAP_WIDTH);
    lines.push(...optionLines);
  }
  lines.push(extraDimText(' */'));
  return lines;
}

function formatParamDoc(option: GeneratedOption, wrapWidth: number): string[] {
  const descriptionLines = option.description?.split(/\r?\n/) ?? [''];
  const optionalSuffix = option.required ? '' : '?';
  const plainLabel = `@param ${option.property}${optionalSuffix}`;
  const continuationPrefix = extraDimText(` * ${' '.repeat(plainLabel.length + 1)}`);
  const rendered: string[] = [];
  descriptionLines.forEach((entry, index) => {
    const suffix = entry.trimEnd();
    if (index === 0) {
      const lineParts = [extraDimText(' * '), yellowText('@param '), cyanText(`${option.property}${optionalSuffix}`)];
      if (suffix.length > 0) {
        const wrapped = wrapCommentText(suffix, wrapWidth - plainLabel.length - 1);
        if (wrapped.length > 0) {
          lineParts.push(extraDimText(` ${wrapped[0]}`));
          rendered.push(lineParts.join(''));
          for (const continuation of wrapped.slice(1)) {
            rendered.push(`${continuationPrefix}${extraDimText(continuation)}`);
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
      rendered.push(`${continuationPrefix}${extraDimText(first)}`);
      for (const segment of rest) {
        rendered.push(`${continuationPrefix}${extraDimText(segment)}`);
      }
    }
  });
  return rendered;
}

export function formatOptionalSummary(hiddenOptions: GeneratedOption[]): string {
  const maxNames = 5;
  const names = hiddenOptions.map((option) => option.property);
  if (names.length === 0) {
    return '';
  }
  const preview = names.slice(0, maxNames).join(', ');
  const suffix = names.length > maxNames ? ', ...' : '';
  return extraDimText(`// optional (${names.length}): ${preview}${suffix}`);
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
