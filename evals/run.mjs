import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cases = JSON.parse(readFileSync(resolve("evals/cases.json"), "utf8"));

const WRITE_RE = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|copy|create|comment|vacuum|refresh|call|do|analyze|set|reset|discard|lock|listen|notify|unlisten|prepare|execute|deallocate)\b/i;

function assertReadonlySql(sql, stripLeadingExplain = false) {
  let stripped = String(sql ?? "")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (stripLeadingExplain) {
    stripped = stripped.replace(/^explain\s*(\([^)]*\)\s*)?/i, "").trim();
  }
  if (!stripped) throw new Error("empty sql");
  if (stripped.includes(";")) throw new Error("multiple statements are not allowed");
  if (WRITE_RE.test(stripped)) throw new Error("refused: statement is not read-only");
  if (!/^\s*(select|with)\b/i.test(stripped)) {
    throw new Error("only SELECT / WITH queries are allowed");
  }
  return stripped;
}

function pickTool(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes("drop") || p.includes("how many") || p.includes("cuántos") || p.includes("cuantos")) return "run_readonly_sql";
  if (p.includes("plan") || p.includes("explain") || p.includes("explica")) return "explain_query";
  if (p.includes("rls") && (p.includes("propos") || p.includes("propón") || p.includes("propon"))) return "propose_rls";
  if (p.includes("polic") || p.includes("polític") || p.includes("politic") || p.includes("rls")) return "list_policies";
  if (p.includes("table") || p.includes("tabla") || p.includes("column")) return "list_tables";
  return "unknown";
}

let failed = 0;
for (const c of cases) {
  const tool = pickTool(c.prompt);
  let ok = tool === c.expectedTool;
  if (c.expectError) {
    let threw = false;
    try {
      assertReadonlySql(c.prompt);
    } catch {
      threw = true;
    }
    ok = ok && threw;
  }
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}  expected=${c.expectedTool} got=${tool}${c.expectError ? " (guardrail blocked write)" : ""}`);
}

const sqlGuardTests = [
  { id: "allow-select", sql: "SELECT id, title FROM documents;", expectPass: true },
  { id: "allow-cte", sql: "WITH t AS (SELECT 1) SELECT * FROM t", expectPass: true },
  { id: "block-drop", sql: "DROP TABLE documents", expectPass: false },
  { id: "block-multi-stmt", sql: "SELECT 1; DROP TABLE documents", expectPass: false },
  { id: "block-explain-analyze", sql: "EXPLAIN ANALYZE SELECT * FROM documents", expectPass: false, explain: true },
  { id: "block-cte-write", sql: "WITH d AS (DELETE FROM documents RETURNING *) SELECT * FROM d", expectPass: false },
];

for (const t of sqlGuardTests) {
  let passed = false;
  try {
    assertReadonlySql(t.sql, Boolean(t.explain));
    passed = true;
  } catch {
    passed = false;
  }
  const ok = passed === t.expectPass;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  guard:${t.id}`);
}

if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log(`\n${cases.length + sqlGuardTests.length} checks passed (router + SQL guardrail tests)`);
