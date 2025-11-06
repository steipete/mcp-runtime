import { parseExpressionAt } from 'acorn';
import type {
  ArrayExpression,
  CallExpression,
  Expression,
  Literal,
  ObjectExpression,
  Property,
  UnaryExpression,
} from 'estree';

interface ParsedCallExpression {
  server?: string;
  tool: string;
  args: Record<string, unknown>;
}

const ACORN_OPTIONS = {
  ecmaVersion: 'latest' as const,
  sourceType: 'module' as const,
};

export function parseCallExpressionFragment(raw: string): ParsedCallExpression | null {
  const trimmed = raw.trim();
  const openParen = trimmed.indexOf('(');
  if (openParen === -1 || !trimmed.endsWith(')')) {
    return null;
  }

  const prefix = trimmed.slice(0, openParen).trim();
  if (!prefix) {
    throw new Error('Expected a tool name before the argument list.');
  }

  const argsPortion = trimmed.slice(openParen + 1, -1);
  const trimmedArgs = argsPortion.trim();
  const attempts = buildParseAttempts(trimmedArgs);
  let callExpression: CallExpression | undefined;
  let parseError: Error | undefined;

  for (const candidate of attempts) {
    try {
      const expression = parseExpressionAt(`__call${candidate}`, 0, ACORN_OPTIONS);
      if (expression.type === 'CallExpression') {
        callExpression = expression as CallExpression;
        break;
      }
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!callExpression) {
    const message = parseError?.message ?? 'Unexpected token';
    throw new Error(`Unable to parse call expression: ${message}`);
  }

  if (callExpression.arguments.length === 0) {
    return {
      ...splitPrefix(prefix),
      args: {},
    };
  }

  if (callExpression.arguments.length > 1) {
    throw new Error(
      'Function-call syntax only supports named arguments. Separate values with commas inside an object.'
    );
  }

  const argument = callExpression.arguments[0];
  if (!argument || argument.type !== 'ObjectExpression') {
    throw new Error('Function-call syntax requires named arguments (e.g. issueId: 123).');
  }

  const args = extractObject(argument);
  return { ...splitPrefix(prefix), args };
}

function splitPrefix(prefix: string): { server?: string; tool: string } {
  const [first, ...rest] = prefix.split('.');
  if (!first) {
    throw new Error('Expected a tool name before the argument list.');
  }
  if (rest.length === 0) {
    return { tool: first };
  }
  return { server: first, tool: rest.join('.') };
}

function extractObject(expression: ObjectExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const property of expression.properties) {
    if (property.type !== 'Property') {
      throw new Error('Unsupported property type in call expression.');
    }
    if (property.kind !== 'init') {
      throw new Error('Only simple assignments are supported in call expressions.');
    }
    if (property.computed) {
      throw new Error('Computed property names are not supported in call expressions.');
    }
    const key = extractKey(property);
    const rawValue = property.value;
    if (!rawValue || !isSupportedValue(rawValue)) {
      throw new Error(`Unsupported argument expression: ${rawValue ? rawValue.type : 'null'}.`);
    }
    const value = extractValue(rawValue);
    result[key] = value;
  }
  return result;
}

function extractKey(property: Property): string {
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value;
  }
  throw new Error('Invalid argument name in call expression.');
}

function extractValue(value: Expression): unknown {
  switch (value.type) {
    case 'Literal':
      return (value as Literal).value ?? null;
    case 'ArrayExpression':
      return extractArray(value as ArrayExpression);
    case 'ObjectExpression':
      return extractObject(value as ObjectExpression);
    case 'UnaryExpression':
      return extractUnary(value as UnaryExpression);
    default:
      throw new Error(`Unsupported argument expression: ${value.type}.`);
  }
}

function extractArray(arrayExpression: ArrayExpression): unknown[] {
  return arrayExpression.elements.map((element, index) => {
    if (!element) {
      throw new Error(`Sparse array entries are not supported (index ${index}).`);
    }
    if (element.type === 'SpreadElement') {
      throw new Error('Spread elements are not supported in call expressions.');
    }
    const elementType = (element as { type?: string }).type ?? 'unknown';
    if (!isSupportedValue(element)) {
      throw new Error(`Unsupported argument expression: ${elementType}.`);
    }
    return extractValue(element as Expression);
  });
}

function extractUnary(expression: UnaryExpression): unknown {
  if (expression.operator === '-' || expression.operator === '+') {
    const inner = expression.argument;
    if (inner.type !== 'Literal' || typeof (inner as Literal).value !== 'number') {
      throw new Error('Unary operators are only supported for numeric literals.');
    }
    const numericValue = Number((inner as Literal).value);
    return expression.operator === '-' ? -numericValue : numericValue;
  }
  if (expression.operator === '!') {
    const inner = expression.argument;
    if (inner.type !== 'Literal' || typeof (inner as Literal).value !== 'boolean') {
      throw new Error('Logical negation is only supported for boolean literals.');
    }
    return !(inner as Literal).value;
  }
  throw new Error(`Unsupported unary operator: ${expression.operator}`);
}

function buildParseAttempts(trimmedArgs: string): string[] {
  if (trimmedArgs === '') {
    return ['()'];
  }
  const attempts: string[] = [`(${trimmedArgs})`];
  const needsObjectWrap =
    !trimmedArgs.startsWith('{') &&
    !trimmedArgs.startsWith('({') &&
    !trimmedArgs.startsWith('[') &&
    /[A-Za-z0-9_]\s*:/.test(trimmedArgs);
  if (needsObjectWrap) {
    attempts.push(`({${trimmedArgs}})`);
  }
  return attempts;
}

function isSupportedValue(node: unknown): node is Expression {
  if (!node || typeof node !== 'object' || !('type' in node)) {
    return false;
  }
  const type = (node as { type: string }).type;
  return type === 'Literal' || type === 'ArrayExpression' || type === 'ObjectExpression' || type === 'UnaryExpression';
}
