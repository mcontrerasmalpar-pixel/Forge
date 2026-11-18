# Forge

MCP server + debugging assistant running on **Supabase Edge Functions**.

Forge inspects database schemas, explains SQL query plans, drafts RLS policies, and executes **read-only** queries scoped to the signed-in user's JWT. No `service_role` key is ever exposed to the client.

Hosted setup guide: [HOSTED.md](./HOSTED.md)  
Repository: https://github.com/mcontrerasmalpar-pixel/forge-mcp-supabase

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

## Quick Start (Hosted Supabase Demo)

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
