import { createClient } from "npm:@supabase/supabase-js@2";
import { AzureOpenAI } from "npm:openai@4";

const SYSTEM = `You are Forge, a Supabase debugging assistant.
Use tools. Never invent columns or tables.
Never ask to run INSERT/UPDATE/DELETE/DROP.
When proposing RLS, remind the user it is a draft and must be reviewed.`;

type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: string };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function mcpCall(req: Request, name: string, args: Record<string, unknown>) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mcp-server`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? "",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return await res.json();
}

async function runDemoAgent(req: Request, prompt: string) {
  const p = prompt.toLowerCase();
  const selectMatch = prompt.match(/\b(select\s+[\s\S]+)$/i);

  let toolName = "run_readonly_sql";
  let args: Record<string, unknown> = { sql: "SELECT id, title, body FROM documents ORDER BY created_at" };

  if (/\b(drop|delete|truncate|update|insert|alter)\b/i.test(p)) {
    toolName = "run_readonly_sql";
    args = { sql: prompt.replace(/^(run|execute|corre)\s+/i, "").trim() };
  } else if (p.includes("plan") || p.includes("explain") || p.includes("explica")) {
    toolName = "explain_query";
    args = { sql: selectMatch ? selectMatch[1] : "SELECT * FROM documents" };
  } else if (p.includes("propos") || p.includes("propon") || p.includes("propón") || p.includes("draft")) {
    toolName = "propose_rls";
    args = { table: "documents", intent: prompt };
  } else if (p.includes("polic") || p.includes("politic") || p.includes("polític") || (p.includes("rls") && !p.includes("document"))) {
    toolName = "list_policies";
    args = {};
  } else if (p.includes("function") || p.includes("funcion") || p.includes("función") || p.includes("rpc")) {
    toolName = "list_functions";
    args = {};
  } else if (p.includes("table") || p.includes("tabla") || p.includes("schema") || p.includes("esquema") || p.includes("column")) {
    toolName = "list_tables";
    args = {};
  } else if (selectMatch) {
    toolName = "run_readonly_sql";
    args = { sql: selectMatch[1] };
  }

  const rpc = await mcpCall(req, toolName, args);
  const trace = [{ tool: toolName, args, result: rpc }];

  if (rpc.error) {
    return {
      role: "assistant",
      content: `MCP Guardrail triggered on \`${toolName}\`: **${rpc.error.message}**`,
      trace,
    };
  }

  const rawText = rpc.result?.content?.[0]?.text ?? "[]";
  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // keep raw string
  }

  if (toolName === "run_readonly_sql" && Array.isArray(parsed)) {
    const titles = parsed
      .map((r: Record<string, unknown>) => `- **${r.title ?? JSON.stringify(r)}**${r.body ? `: ${r.body}` : ""}`)
      .join("\n");
    return {
      role: "assistant",
      content:
        `Executed \`run_readonly_sql\` with your user JWT (RLS enforced).\n\n` +
        `Visible documents in your organization (\`acme-alpha\`): **${parsed.length}** (rows belonging to \`beta-shadow\` were filtered out by PostgreSQL RLS):\n\n${titles || "_No rows returned_"}`,
      trace,
    };
  }

  return {
    role: "assistant",
    content: `Output from MCP tool \`${toolName}\`:\n\`\`\`json\n${typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}\n\`\`\``,
    trace,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return jsonResponse({ role: "assistant", content: "Unauthorized (missing or invalid user JWT)." }, 401);
    }

    const { messages } = (await req.json()) as { messages: ChatMsg[] };
    const rawEndpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT")?.trim();
    const key = Deno.env.get("AZURE_OPENAI_API_KEY")?.trim();
    const deployment = Deno.env.get("AZURE_OPENAI_DEPLOYMENT")?.trim() || "gpt-4o-mini";
    const apiVersion = Deno.env.get("AZURE_OPENAI_API_VERSION")?.trim() || "2024-08-01-preview";

    if (!rawEndpoint || !key) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      return jsonResponse(await runDemoAgent(req, lastUser));
    }

    // Si en el secret se pego la URL completa de Azure Portal (/openai/deployments/...), extraemos solo el origin
    const endpoint = new URL(rawEndpoint).origin;

    const azureClient = new AzureOpenAI({
      apiKey: key,
      endpoint,
      deployment,
      apiVersion,
    });

    const tools = [
      { type: "function", function: { name: "list_tables", description: "List public tables", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "list_policies", description: "List RLS policies", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "list_functions", description: "List public SQL functions", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "explain_query", description: "EXPLAIN a read-only query", parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } } },
      { type: "function", function: { name: "propose_rls", description: "Draft an RLS policy. Does not apply it.", parameters: { type: "object", properties: { table: { type: "string" }, intent: { type: "string" } }, required: ["table", "intent"] } } },
      { type: "function", function: { name: "run_readonly_sql", description: "Run SELECT as the current user", parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } } },
    ];

    // deno-lint-ignore no-explicit-any
    const payloadMessages: any[] = [
      { role: "system", content: SYSTEM },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // deno-lint-ignore no-explicit-any
    async function complete(msgs: any[]) {
      return await azureClient.chat.completions.create({
        model: deployment,
        messages: msgs,
        // deno-lint-ignore no-explicit-any
        tools: tools as any,
        temperature: 0.2,
      });
    }

    let completion = await complete(payloadMessages);
    let choice = completion.choices[0];
    const trace: unknown[] = [];

    for (let i = 0; i < 4 && choice?.message?.tool_calls; i++) {
      payloadMessages.push(choice.message);
      for (const call of choice.message.tool_calls) {
        const args = JSON.parse(call.function.arguments || "{}");
        const result = await mcpCall(req, call.function.name, args);
        trace.push({ tool: call.function.name, args, result });
        payloadMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      completion = await complete(payloadMessages);
      choice = completion.choices[0];
    }

    return jsonResponse({ role: "assistant", content: choice?.message?.content ?? "", trace });
  } catch (error) {
    return jsonResponse(
      { role: "assistant", content: `Error conectando con Azure: ${(error as Error).message}` },
      500,
    );
  }
});
