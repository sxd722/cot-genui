/**
 * Detect whether a streamed OpenUI buffer contains at least one complete
 * top-level statement. Newlines inside strings or nested argument lists do not
 * count as statement boundaries.
 */
export function hasCompleteOpenUIStatement(source: string, allowTrailingLine = false): boolean {
  let depth = 0;
  let escaped = false;
  let quote: '"' | "'" | null = null;
  let lineStart = 0;

  const isStatement = (line: string) => /^[$A-Za-z_][$\w]*\s*=\s*\S/.test(line.trim());

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth = Math.max(0, depth - 1);

    if (character === "\n" && depth === 0) {
      if (isStatement(source.slice(lineStart, index))) return true;
      lineStart = index + 1;
    }
  }

  return allowTrailingLine && depth === 0 && quote === null && isStatement(source.slice(lineStart));
}
