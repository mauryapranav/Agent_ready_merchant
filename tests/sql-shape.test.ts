import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* A parameterised INSERT whose column list and VALUES list disagree only fails when the
 * statement actually runs. persistSession shipped with 21 columns against $1..$20 and went
 * unnoticed because the pages that trigger a session had broken JavaScript, so nothing ever
 * called it — and when it finally ran it took the whole process down. Catch it at test time. */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function splitTopLevel(list: string): string[] {
  // Column and value lists are flat here, but a value can be an expression such as NOW().
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

test("every INSERT lists as many values as columns", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("scripts")];
  const problems: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const re = /INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(((?:[^()]|\([^()]*\))*)\)/gis;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const cols = splitTopLevel(m[2]!);
      const vals = splitTopLevel(m[3]!);
      if (cols.length !== vals.length) {
        const line = src.slice(0, m.index).split("\n").length;
        problems.push(`${file}:${line} INSERT INTO ${m[1]} has ${cols.length} columns but ${vals.length} values`);
      }
    }
  }

  assert.deepEqual(problems, [], "column/value count mismatch:\n" + problems.join("\n"));
});

test("placeholder numbering in an INSERT is contiguous from $1", () => {
  const files = sourceFiles("src");
  const problems: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const re = /INSERT\s+INTO\s+(\w+)\s*\([^)]*\)\s*VALUES\s*\(((?:[^()]|\([^()]*\))*)\)/gis;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const nums = [...m[2]!.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]));
      if (nums.length === 0) continue;
      const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
      if (JSON.stringify([...nums].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
        const line = src.slice(0, m.index).split("\n").length;
        problems.push(`${file}:${line} INSERT INTO ${m[1]} placeholders are not $1..$${nums.length}: ${nums.join(",")}`);
      }
    }
  }

  assert.deepEqual(problems, [], "placeholder numbering:\n" + problems.join("\n"));
});

test("array-typed columns are not bound with JSON.stringify", () => {
  // allowed_rails is TEXT[]; passing JSON.stringify(...) yields the literal ["upi","card"],
  // which Postgres rejects as a malformed array literal at runtime only.
  const schema = readFileSync("src/db/migrations/001_initial_schema.sql", "utf8");
  const arrayCols = new Set(
    [...schema.matchAll(/^\s*(\w+)\s+(?:TEXT|VARCHAR|INT|BIGINT)\[\]/gim)].map((m) => m[1]!)
  );
  assert.ok(arrayCols.size > 0, "expected the schema to declare at least one array column");

  const problems: string[] = [];
  for (const file of sourceFiles("src")) {
    const src = readFileSync(file, "utf8");
    // [\s\S]*? spans any trailing SQL (an ON CONFLICT clause) between VALUES and the closing
    // backtick, then captures the parameter array that follows it.
    const re = /INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(((?:[^()]|\([^()]*\))*)\)[\s\S]*?`,\s*\[([\s\S]*?)\]\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const cols = splitTopLevel(m[2]!);
      const args = splitTopLevel(m[4]!.replace(/\/\/[^\n]*/g, ""));
      cols.forEach((col, i) => {
        if (!arrayCols.has(col)) return;
        const arg = args[i];
        if (arg && /JSON\.stringify/.test(arg)) {
          problems.push(`${file}: ${m![1]}.${col} is an array column but is bound with ${arg.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(problems, [], "array column bound as JSON:\n" + problems.join("\n"));
});
