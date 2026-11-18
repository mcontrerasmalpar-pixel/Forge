"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Msg = { role: "user" | "assistant"; content: string; trace?: unknown };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export default function Page() {
  const supabase = useMemo(() => {
    if (!hasSupabaseConfig) return null;
    return createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [input, setInput] = useState("Cuantos documents puedo ver y cuales son sus titulos?");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [hasJwt, setHasJwt] = useState(false);
  const [demoHint, setDemoHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refreshSession() {
    if (!supabase) {
      setSessionEmail(null);
      setHasJwt(false);
      return null;
    }
    const { data } = await supabase.auth.getSession();
    setSessionEmail(data.session?.user.email ?? null);
    setHasJwt(Boolean(data.session?.access_token));
    return data.session;
  }

  useEffect(() => {
    if (!supabase) return;
    void refreshSession();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refreshSession();
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function signInOnly(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!supabase) return setErr("Falta configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    if (data.session) await refreshSession();
  }

  async function signUpOnly() {
    setErr(null);
    if (!supabase) return setErr("Falta configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return setErr(error.message);
    if (!data.session) {
      setErr("Usuario creado. Desactiva Confirm email y pulsa Solo entrar.");
      return;
    }
    await refreshSession();
  }

  async function loadDemo() {
    setErr(null);
    if (!supabase) return setErr("Falta configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    const session = await refreshSession();
    if (!session?.access_token) {
      setErr("No hay JWT. Entra con Solo entrar.");
      return;
    }
    const { data, error } = await supabase.rpc("forge_bootstrap_demo");
    if (error) return setErr(error.message);
    setDemoHint(JSON.stringify(data, null, 2));
  }

  async function runDirectMcpFallback(promptText: string, accessToken: string) {
    const p = promptText.toLowerCase();
    const selectMatch = promptText.match(/\b(select\s+[\s\S]+)$/i);

    let toolName = "run_readonly_sql";
    let args: Record<string, unknown> = {
      sql: "SELECT title, body FROM documents ORDER BY created_at",
    };

    if (/\b(drop|delete|truncate|update|insert|alter)\b/i.test(p)) {
      toolName = "run_readonly_sql";
      args = { sql: promptText.replace(/^corre\s+/i, "").trim() };
    } else if (p.includes("plan") || p.includes("explain") || p.includes("explica")) {
      toolName = "explain_query";
      args = { sql: selectMatch ? selectMatch[1] : "SELECT * FROM documents" };
    } else if (p.includes("propon") || p.includes("propón") || p.includes("draft")) {
      toolName = "propose_rls";
      args = { table: "documents", intent: promptText };
    } else if (p.includes("politic") || p.includes("polític") || (p.includes("rls") && !p.includes("document"))) {
      toolName = "list_policies";
      args = {};
    } else if (p.includes("funcion") || p.includes("función") || p.includes("rpc")) {
      toolName = "list_functions";
      args = {};
    } else if (p.includes("tabla") || p.includes("schema") || p.includes("esquema") || p.includes("columna")) {
      toolName = "list_tables";
      args = {};
    } else if (selectMatch) {
      toolName = "run_readonly_sql";
      args = { sql: selectMatch[1] };
    }

    const mcpRes = await fetch(`${supabaseUrl}/functions/v1/mcp-server`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
        apikey: supabaseKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    const rpc = await mcpRes.json();
    const trace = [{ tool: toolName, args, result: rpc }];

    if (rpc.error) {
      return {
        content: `🛡️ Guardrail MCP activado en \`${toolName}\`: ${rpc.error.message}`,
        trace,
      };
    }

    const rawText = rpc.result?.content?.[0]?.text ?? "[]";
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // keep raw
    }

    if (toolName === "run_readonly_sql" && Array.isArray(parsed)) {
      const lines = parsed
        .map((r: Record<string, unknown>) => `• ${r.title ?? JSON.stringify(r)}${r.body ? ` — ${r.body}` : ""}`)
        .join("\n");
      return {
        content:
          `✅ Consulta ejecutada vía MCP (\`run_readonly_sql\`) con tu JWT (RLS activo).\n` +
          `Documentos visibles para tu organización (acme-alpha): ${parsed.length} (los documentos de beta-shadow están ocultos por RLS):\n\n${lines || "(Sin filas)"}`,
        trace,
      };
    }

    return {
      content: `✅ Resultado de MCP tool \`${toolName}\`:\n${typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}`,
      trace,
    };
  }

  async function send(customPrompt?: string) {
    const promptText = (customPrompt ?? input).trim();
    if (!promptText) return;
    setBusy(true);
    setErr(null);
    if (!supabase) {
      setErr("Falta configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      setBusy(false);
      return;
    }
    const next = [...msgs, { role: "user" as const, content: promptText }];
    setMsgs(next);
    if (!customPrompt) setInput("");
    const session = await refreshSession();
    if (!session?.access_token) {
      setErr("No hay JWT. Entra con Solo entrar.");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
          apikey: supabaseKey,
        },
        body: JSON.stringify({ messages: next }),
      });
      const json = await res.json();
      const content = String(json.content ?? JSON.stringify(json));
      if (content.includes("Azure OpenAI no esta configurado")) {
        const fallback = await runDirectMcpFallback(promptText, session.access_token);
        setMsgs([...next, { role: "assistant", content: fallback.content, trace: fallback.trace }]);
      } else {
        setMsgs([...next, { role: "assistant", content, trace: json.trace }]);
      }
    } catch (e) {
      setErr(`chat fetch: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, letterSpacing: -0.4 }}>Forge</h1>
      <p style={{ color: "#9bb0c4" }}>
        JWT: {hasJwt ? "si" : "no"} · {sessionEmail ?? "sin sesion"}
      </p>

      {err ? <p style={{ color: "#ff8b8b" }}>{err}</p> : null}
      {!hasSupabaseConfig ? (
        <p style={{ color: "#ff8b8b" }}>
          Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY para usar la app.
        </p>
      ) : null}

      {!hasJwt ? (
        <form onSubmit={signInOnly} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
          <input
            id="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
          />
          <input
            id="password"
            name="password"
            autoComplete="current-password"
            value={password}
            type="password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
          />
          <button type="submit">Solo entrar</button>
          <button type="button" onClick={signUpOnly}>
            Solo registrar
          </button>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" onClick={loadDemo}>
            Cargar demo RLS
          </button>
          <button type="button" onClick={() => supabase?.auth.signOut().then(() => refreshSession())}>
            Salir
          </button>
        </div>
      )}

      {demoHint ? (
        <pre style={{ background: "#12181f", padding: 12, borderRadius: 8, color: "#9bb0c4" }}>
          {demoHint}
        </pre>
      ) : null}

      <section style={{ marginTop: 24, display: "grid", gap: 12 }}>
        {msgs.map((m, i) => (
          <article
            key={i}
            style={{
              background: m.role === "user" ? "#15202b" : "#12181f",
              border: "1px solid #243140",
              borderRadius: 12,
              padding: 14,
              whiteSpace: "pre-wrap",
            }}
          >
            <strong>{m.role}</strong>
            <div style={{ marginTop: 6 }}>{m.content}</div>
            {m.trace ? (
              <details style={{ marginTop: 10, color: "#9bb0c4", fontSize: 13 }}>
                <summary style={{ cursor: "pointer" }}>Ver MCP tool trace</summary>
                <pre style={{ overflowX: "auto", marginTop: 8 }}>
                  {JSON.stringify(m.trace, null, 2)}
                </pre>
              </details>
            ) : null}
          </article>
        ))}
      </section>

      {hasJwt ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
          {[
            "Cuantos documents puedo ver y cuales son sus titulos?",
            "Lista las politicas RLS",
            "Que tablas y columnas hay?",
            "Explica el plan de SELECT * FROM documents",
            "Propon RLS para documents",
            "DROP TABLE documents",
          ].map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void send(q)}
              style={{
                background: "#15202b",
                color: "#9bb0c4",
                border: "1px solid #243140",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || !hasJwt} onClick={() => void send()}>
          {busy ? "..." : "Enviar"}
        </button>
      </div>
    </main>
  );
}
