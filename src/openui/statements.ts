export interface OpenUIStatement {
  id: string;
  source: string;
  rhs: string;
  start: number;
  end: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseStatement(source: string, start: number, end: number): OpenUIStatement | null {
  const raw = source.slice(start, end);
  const leading = raw.search(/\S/);
  if (leading < 0) return null;
  const trailing = raw.length - raw.trimEnd().length;
  const statementStart = start + leading;
  const statementEnd = end - trailing;
  const statementSource = source.slice(statementStart, statementEnd);
  const match = statementSource.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
  return {
    id: match?.[1] ?? "",
    rhs: match?.[2] ?? statementSource,
    source: statementSource,
    start: statementStart,
    end: statementEnd,
  };
}

/** Split only on top-level newlines; quoted strings and nested calls may span lines. */
export function splitOpenUIStatements(source: string): OpenUIStatement[] {
  const statements: OpenUIStatement[] = [];
  let start = 0;
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;

  const flush = (end: number) => {
    const parsed = parseStatement(source, start, end);
    if (parsed) statements.push(parsed);
    start = end + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") parentheses += 1;
    else if (char === ")") parentheses = Math.max(0, parentheses - 1);
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "\n" && parentheses === 0 && brackets === 0 && braces === 0) flush(index);
  }
  const final = parseStatement(source, start, source.length);
  if (final) statements.push(final);
  return statements;
}

export function referencedStatementIds(statement: OpenUIStatement, knownIds: ReadonlySet<string>): string[] {
  const tokens = statement.rhs.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return [...new Set(tokens.filter((token) => knownIds.has(token) && token !== statement.id))];
}

export function isAssignmentStatement(statement: OpenUIStatement): boolean {
  return IDENTIFIER.test(statement.id);
}

