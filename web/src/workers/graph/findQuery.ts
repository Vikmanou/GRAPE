export type FindQuery = { kind: 'names'; names: string[] } | { kind: 'regex'; source: string };

/**
 * A list of exact names split on commas and whitespace (GFA names hold no
 * whitespace), or, with `regex`, a pattern matched anywhere in a name.
 */
export function parseFindQuery(text: string, regex: boolean): FindQuery | undefined {
  if (regex) {
    const source = text.trim();
    return source ? { kind: 'regex', source } : undefined;
  }
  const names = [...new Set(text.split(/[\s,]+/).filter((name) => name.length > 0))];
  return names.length > 0 ? { kind: 'names', names } : undefined;
}

/** Throws a readable error for a pattern JavaScript cannot compile. */
export function compileFindRegex(source: string): RegExp {
  try {
    return new RegExp(source, 'u');
  } catch (error) {
    throw new Error(`Not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}
