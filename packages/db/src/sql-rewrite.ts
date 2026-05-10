// node:sqlite returns query results as objects keyed by column name. When two
// SELECT columns share the same final name (e.g. `accounts.name` and
// `cat.name` both becoming `name`), the second silently overwrites the first
// in the JS object — and we lose data.
//
// Drizzle's sqlite-proxy adapter doesn't auto-alias every column. To preserve
// every column in result objects, we rewrite the top-level SELECT clause and
// add a positional alias (AS _c0, _c1, ...) to every column expression that
// isn't already aliased.
//
// We only touch the OUTERMOST select. Inner subqueries are passed through
// unchanged, since their result columns are consumed inside SQL, not by us.

export function aliasSelectColumns(sql: string): string {
  // Locate the first "select " at top depth.
  const selectIdx = findKeywordAt(sql, 0, "select");
  if (selectIdx < 0) return sql;
  const colsStart = selectIdx + "select ".length;
  // Optional "distinct ".
  let cursor = skipWhitespace(sql, colsStart);
  if (matchKeyword(sql, cursor, "distinct")) cursor += "distinct ".length;
  const colsBegin = cursor;
  const fromIdx = findKeywordAt(sql, colsBegin, "from");
  if (fromIdx < 0) return sql;
  const colsEnd = fromIdx;

  const colsRaw = sql.slice(colsBegin, colsEnd);
  const cols = splitTopLevelCommas(colsRaw);
  const rewritten = cols
    .map((c, i) => {
      const trimmed = c.trim();
      if (!trimmed) return c;
      if (hasAlias(trimmed)) return c; // already aliased; leave alone
      // Preserve trailing whitespace structure.
      const trailingWs = c.match(/\s*$/)?.[0] ?? "";
      const leadingWs = c.match(/^\s*/)?.[0] ?? "";
      return `${leadingWs}${trimmed} as "_c${i}"${trailingWs}`;
    })
    .join(",");

  return sql.slice(0, colsBegin) + rewritten + sql.slice(colsEnd);
}

// Find first occurrence of `keyword` (case-insensitive, word-bounded) at
// paren-depth 0 starting from `from`. Returns -1 if not found.
function findKeywordAt(sql: string, from: number, keyword: string): number {
  const lower = sql.toLowerCase();
  let depth = 0;
  let inStr: '"' | "'" | "`" | null = null;
  for (let i = from; i < sql.length; i++) {
    const c = sql[i]!;
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c as '"' | "'" | "`";
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) {
      if (lower.startsWith(keyword, i) && isWordBoundary(sql, i - 1) && isWordBoundary(sql, i + keyword.length)) {
        return i;
      }
    }
  }
  return -1;
}

function matchKeyword(sql: string, at: number, keyword: string): boolean {
  if (sql.slice(at, at + keyword.length).toLowerCase() !== keyword) return false;
  return isWordBoundary(sql, at - 1) && isWordBoundary(sql, at + keyword.length);
}

function isWordBoundary(sql: string, at: number): boolean {
  if (at < 0 || at >= sql.length) return true;
  return !/[A-Za-z0-9_]/.test(sql[at]!);
}

function skipWhitespace(sql: string, at: number): number {
  while (at < sql.length && /\s/.test(sql[at]!)) at++;
  return at;
}

// Split a comma-separated list while respecting parens and string literals.
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: '"' | "'" | "`" | null = null;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c as '"' | "'" | "`";
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

// Detect ` AS alias` (case-insensitive) at the END of a column expression,
// allowing for quoted aliases. Also treats trailing `"x"` as an alias even
// without `AS` (SQLite syntax).
function hasAlias(col: string): boolean {
  // " AS alias" or " AS \"alias\""
  if (/\s+as\s+("?\w+"?|`[^`]+`|\[[^\]]+\])\s*$/i.test(col)) return true;
  // Bare alias following an expression: `expr "alias"` — but this is risky
  // because `"transactions"."id"` ends with `"id"` which could look bare. We
  // therefore do NOT treat bare-trailing-quoted-identifier as aliased; we
  // require explicit AS.
  return false;
}
