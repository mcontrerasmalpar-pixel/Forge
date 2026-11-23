# Forge

[![MCP Evals & SQL Guardrails](https://github.com/mcontrerasmalpar-pixel/Forge/actions/workflows/evals.yml/badge.svg)](https://github.com/mcontrerasmalpar-pixel/Forge/actions/workflows/evals.yml)
[![Deploy Supabase Edge Functions](https://github.com/mcontrerasmalpar-pixel/Forge/actions/workflows/deploy-functions.yml/badge.svg)](https://github.com/mcontrerasmalpar-pixel/Forge/actions/workflows/deploy-functions.yml)
[![Supabase](https://img.shields.io/badge/Supabase-Edge_Functions_%26_RLS-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![MCP](https://img.shields.io/badge/MCP-JSON--RPC_2.0-000000)](https://modelcontextprotocol.io)
[![Deno](https://img.shields.io/badge/Deno-Edge_Runtime-000000?logo=deno&logoColor=white)](https://deno.com)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

MCP server + debugging assistant running on **Supabase Edge Functions**.

Forge inspects database schemas, explains SQL query plans, drafts RLS policies, and executes **read-only** queries scoped to the signed-in user's JWT. No `service_role` key is ever exposed to the client.

Hosted setup guide: [HOSTED.md](./HOSTED.md)  
Repository: https://github.com/mcontrerasmalpar-pixel/Forge

## What It Demonstrates

- **MCP Server on Supabase Edge Functions** (Deno, JSON-RPC 2.0)
- **Allowlisted MCP Tools** with multi-layer read-only SQL guardrails (blocks destructive DDL/DML)
- **PostgreSQL RLS as the Authorization Layer** (`security invoker` RPCs, zero frontend permission hacks)
- **Multi-Tenant RLS Isolation Demo**: visible tenant `acme-alpha` vs isolated tenant `beta-shadow`
- **Next.js Assistant UI** with live JWT session, one-click **Seed RLS Demo**, and expandable **MCP tool trace**
- **Optional LLM Orchestrator** (`AzureOpenAI` SDK) with a built-in zero-key MCP router fallback so the demo works out of the box

## Architecture

```
Cursor / Web Assistant UI
        |  MCP JSON-RPC 2.0 (Bearer User JWT)
        v
Edge Function: mcp-server
        |  Postgres RPCs + Row Level Security (auth.uid())
        v
PostgreSQL
```

The `chat` Edge Function orchestrates tool calls via `AzureOpenAI` when configured, or falls back to a deterministic MCP tool router so every tool (`list_tables`, `list_policies`, `list_functions`, `explain_query`, `propose_rls`, `run_readonly_sql`) can be tested live without paid LLM quota.

## Try It in 30 Seconds (Zero Setup — Connects to Hosted Demo Backend)

The web assistant is pre-wired to a live hosted Supabase project protected by PostgreSQL RLS (`https://skxljgnpjmnekvecpfjd.supabase.co`), with a ready-to-use demo account pre-filled in the UI:

```bash
git clone https://github.com/mcontrerasmalpar-pixel/Forge.git
cd Forge/apps/web
npm install
npm run dev
```

1. Open **http://localhost:3000**
2. Click **Sign in** (pre-filled with `demo@forge.dev` / `ForgeDemo123!`) → status updates to `JWT: yes · demo@forge.dev`.
3. Click **Seed RLS Demo** → seeds two tenants (`your_org: "acme-alpha"` and `hidden_org: "beta-shadow"`).
4. Click any quick-prompt chip (e.g. *How many documents can I see and what are their titles?* or *DROP TABLE documents*) and expand **View MCP tool trace** to inspect the raw JSON-RPC 2.0 tool call and response.

Run the automated router + SQL guardrail test suite from the repo root:

```bash
npm run evals
```

## Key Files for Code Review

- [`supabase/functions/mcp-server/index.ts`](./supabase/functions/mcp-server/index.ts) — Edge Function MCP server (`initialize`, `tools/list`, `tools/call`, SQL read-only validator, rate limiter).
- [`supabase/migrations/20260907000000_init.sql`](./supabase/migrations/20260907000000_init.sql) — Multi-tenant schema (`organizations`, `memberships`, `documents`, `usage_events`) and RLS policies using `my_org_ids()`.
- [`supabase/migrations/20260907000001_forge_rpcs.sql`](./supabase/migrations/20260907000001_forge_rpcs.sql) — Catalog inspection RPCs (`security definer`, restricted to `service_role`) and query execution RPCs (`security invoker`, `default_transaction_read_only = on`, `statement_timeout = '3s'`).
- [`supabase/migrations/20260907000002_bootstrap_demo.sql`](./supabase/migrations/20260907000002_bootstrap_demo.sql) — Idempotent two-tenant RLS fixture (`acme-alpha` vs `beta-shadow`).
- [`supabase/functions/chat/index.ts`](./supabase/functions/chat/index.ts) — Optional `AzureOpenAI` tool-calling loop with a built-in zero-key MCP router fallback.
- [`evals/run.mjs`](./evals/run.mjs) — 12 automated checks covering tool routing and SQL injection/DDL guardrails.
- [`server.json`](./server.json) — Official MCP Registry manifest (`streamable-http` remote specification).

## Deploy to Your Own Supabase Project

1. Create a Supabase project and link this repository (or run `npx supabase db push` + `npx supabase functions deploy`).
2. Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # anon or publishable key
```

3. Run the web assistant:

```bash
cd apps/web
npm install
npm run dev
```

4. In Supabase Dashboard → **Authentication → Providers → Email**, disable **Confirm email** for quick demo testing.
5. Sign up / Sign in → status shows `JWT: yes`.
6. Click **Seed RLS Demo** → returns JSON confirming `your_org: "acme-alpha"` and `hidden_org: "beta-shadow"`.
7. Click any quick-prompt chip (or ask a question) and expand **View MCP tool trace** to inspect the raw JSON-RPC payload.

## Connect from Cursor (Direct MCP)

Copy `.cursor/mcp.json.example` to `.cursor/mcp.json` and point it to your deployed `mcp-server` function:

```json
{
  "mcpServers": {
    "forge": {
      "url": "https://YOUR_REF.supabase.co/functions/v1/mcp-server",
      "headers": {
        "Authorization": "Bearer USER_JWT",
        "apikey": "SUPABASE_ANON_KEY"
      }
    }
  }
}
```

`USER_JWT` is the `access_token` of a signed-in user session. Every MCP tool call inherits PostgreSQL RLS permissions from that JWT.

## Allowlisted MCP Tools

| Tool | Guardrail |
|---|---|
| `list_tables` | Catalog metadata only (`public` schema) |
| `list_policies` | Read-only `pg_policy` inspection |
| `list_functions` | Read-only `pg_proc` inspection |
| `explain_query` | `SELECT`/`WITH` only + read-only transaction + `EXPLAIN (FORMAT JSON)` |
| `propose_rls` | Returns a reviewable SQL migration draft (`applied: false`) |
| `run_readonly_sql` | Single `SELECT`/`WITH` statement + `default_transaction_read_only = on` + `3s` timeout + RLS |

## Optional Azure OpenAI Configuration

If you want `chat` to use Azure OpenAI instead of the built-in MCP router:

```bash
npx supabase secrets set AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com
npx supabase secrets set AZURE_OPENAI_API_KEY=...
npx supabase secrets set AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
npx supabase functions deploy chat --project-ref YOUR_REF
```

## Security Model & Evals

1. Client only uses the public `anon`/`publishable` key + user session JWT.
2. `run_readonly_sql` and `explain_query` strip comments, reject multi-statement queries, block write/DDL/session keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `ANALYZE`, `SET`, `LOCK`, etc.), enforce `SET LOCAL default_transaction_read_only = on`, and cap execution at `3s`.
3. `propose_rls` drafts policies without executing DDL.
4. Per-user rate limiting (`40 tools/min`) tracked by `auth.uid()`.

Run the router + SQL guardrail evaluation suite:

```bash
npm run evals
```

## License

MIT
