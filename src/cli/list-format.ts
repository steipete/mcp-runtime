import type { ServerDefinition, ServerSource } from '../config.js';
import { analyzeConnectionError } from '../error-classifier.js';
import type { ServerToolInfo } from '../runtime.js';
import { formatPathForDisplay } from './path-utils.js';
import { dimText, extraDimText, redText, yellowText } from './terminal.js';

export type StatusCategory = 'ok' | 'auth' | 'offline' | 'http' | 'error';

export type ListSummaryResult =
  | {
      status: 'ok';
      server: ServerDefinition;
      tools: ServerToolInfo[];
      durationMs: number;
    }
  | {
      status: 'error';
      server: ServerDefinition;
      error: unknown;
      durationMs: number;
    };

export function renderServerListRow(
  result: ListSummaryResult,
  timeoutMs: number
): {
  line: string;
  summary: string;
  category: StatusCategory;
  authCommand?: string;
} {
  const description = result.server.description ? dimText(` — ${result.server.description}`) : '';
  const durationLabel = dimText(`${(result.durationMs / 1000).toFixed(1)}s`);
  const sourceSuffix = formatSourceSuffix(result.server.source);
  const prefix = `- ${result.server.name}${description}`;

  if (result.status === 'ok') {
    const toolSuffix =
      result.tools.length === 0
        ? 'no tools reported'
        : `${result.tools.length === 1 ? '1 tool' : `${result.tools.length} tools`}`;
    return {
      line: `${prefix} (${toolSuffix}, ${durationLabel})${sourceSuffix}`,
      summary: toolSuffix,
      category: 'ok',
    };
  }

  const timeoutSeconds = Math.round(timeoutMs / 1000);
  const advice = classifyListError(result.error, result.server.name, timeoutSeconds);
  return {
    line: `${prefix} (${advice.colored}, ${durationLabel})${sourceSuffix}`,
    summary: advice.summary,
    category: advice.category,
    authCommand: advice.authCommand,
  };
}

export function truncateForSpinner(text: string, maxLength = 72): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatSourceSuffix(source: ServerSource | undefined, inline = false): string {
  if (!source || source.kind !== 'import') {
    return '';
  }
  const formatted = formatPathForDisplay(source.path);
  const text = inline ? formatted : `[source: ${formatted}]`;
  const tinted = extraDimText(text);
  return inline ? tinted : ` ${tinted}`;
}

export function classifyListError(
  error: unknown,
  serverName: string,
  _timeoutSeconds: number,
  options?: { authCommand?: string }
): {
  colored: string;
  summary: string;
  category: StatusCategory;
  authCommand?: string;
} {
  const issue = analyzeConnectionError(error);
  if (issue.kind === 'auth') {
    const authCommand = options?.authCommand ?? `mcporter auth ${serverName}`;
    const note = yellowText(`auth required — run '${authCommand}'`);
    return { colored: note, summary: 'auth required', category: 'auth', authCommand };
  }
  if (issue.kind === 'offline') {
    const note = redText('offline — unable to reach server');
    return { colored: note, summary: 'offline', category: 'offline' };
  }
  if (issue.kind === 'http') {
    const statusText = issue.statusCode ? `HTTP ${issue.statusCode}` : 'HTTP error';
    const detail = issue.rawMessage && issue.rawMessage !== String(issue.statusCode) ? ` — ${issue.rawMessage}` : '';
    const note = redText(`${statusText}${detail}`);
    return { colored: note, summary: statusText.toLowerCase(), category: 'http' };
  }
  const rawMessage = issue.rawMessage || 'unknown error';
  const note = redText(rawMessage);
  return { colored: note, summary: rawMessage, category: 'error' };
}
