# Connecting Forge to a Hosted Supabase Project

1. Create a project at https://supabase.com/dashboard (choose a region close to you, e.g., `sa-east-1` or `us-east-1`).
2. From the repository root:

```bash
npx supabase link --project-ref YOUR_REF
npx supabase db push
npx supabase functions deploy mcp-server
npx supabase functions deploy chat
```

3. Optional Azure OpenAI secrets (for the `chat` Edge Function):

```bash
npx supabase secrets set AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com
npx supabase secrets set AZURE_OPENAI_API_KEY=...
npx supabase secrets set AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
```

4. Configure `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

5. In the web UI: sign up/sign in and click **Seed RLS Demo**.
   This assigns your user to `acme-alpha` and seeds confidential documents in `beta-shadow` that PostgreSQL RLS prevents your session from reading.

6. Test prompts in the assistant UI:

- `How many documents can I see and what are their titles?`
- `List RLS policies`
- `What tables and columns exist?`
- `Explain the query plan for SELECT * FROM documents`
- `Propose an RLS policy for documents`
- `DROP TABLE documents` — blocked by the MCP read-only guardrail

Auth note: Enable **Authentication → Providers → Email** and disable **Confirm email** while running demos.
