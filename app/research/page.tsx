"use client";

// /research — operator console for the Connoisseur MCP. Lists all tools the
// server exposes, lets you pick one, fills in args via a generated form (or
// raw JSON for complex schemas), and shows the response.
//
// This is the standalone surface. The same MCP client (lib/connoisseur.ts) is
// also called server-side from the Scripts and Briefs generators to enrich
// their prompts — see those routes for the embedded usage.

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Play, Search, AlertCircle, ChevronRight } from "lucide-react";
import { useToast } from "@/components/toast";

type Tool = {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
};

type CallResult = {
  json?: any;
  text?: string;
  isError?: boolean;
  error?: string;
};

// Loose grouping by tool-name prefix so the operator can scan 30 tools fast.
// Reddit-sourced consumer language tends to live behind `text_search`,
// `get_voice_atoms`, and the production-brief tools.
const GROUPS: { label: string; match: (name: string) => boolean }[] = [
  { label: "Reddit / voice / consumer language", match: (n) => /voice_atom|text_search|selling_points/.test(n) },
  { label: "Portfolio queries", match: (n) => /^(list|get|count)_ad|list_brands|list_static/.test(n) },
  { label: "Performance + concentration", match: (n) => /pattern_|concentration|tried_vs|tenure/.test(n) },
  { label: "Decision aids", match: (n) => /winners|losers|similar_prior|pre_ship/.test(n) },
  { label: "Image analysis", match: (n) => /image|describe_ad/.test(n) },
  { label: "Behavioral spine", match: (n) => /protocol|decision|investigate_peer|current_state/.test(n) },
  { label: "Production briefing", match: (n) => /archetype_performance|winner_combos|compliance|generate_production/.test(n) },
];

function groupOf(name: string): string {
  return GROUPS.find((g) => g.match(name))?.label ?? "Other";
}

export default function ResearchPage() {
  const toast = useToast();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [argsText, setArgsText] = useState<string>("{}");
  const [argsForm, setArgsForm] = useState<Record<string, any>>({});
  const [useRawJson, setUseRawJson] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);

  useEffect(() => {
    fetch("/api/connoisseur/tools", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) {
          toast.error(data.error);
          return;
        }
        setTools(data.tools ?? []);
        setServerUrl(data.server_url ?? null);
      })
      .catch((err) => toast.error(err?.message ?? "failed to load tools"))
      .finally(() => setLoadingTools(false));
  }, [toast]);

  const grouped = useMemo(() => {
    const filtered = tools.filter(
      (t) => !search.trim() || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? "").toLowerCase().includes(search.toLowerCase())
    );
    const buckets: Record<string, Tool[]> = {};
    for (const t of filtered) {
      const g = groupOf(t.name);
      (buckets[g] ||= []).push(t);
    }
    return buckets;
  }, [tools, search]);

  const currentTool = tools.find((t) => t.name === selected) ?? null;

  // When the operator picks a new tool, reset args (form + JSON) so a stale
  // payload from the previous tool doesn't accidentally apply.
  useEffect(() => {
    if (!currentTool) return;
    setArgsForm({});
    setArgsText("{}");
    setResult(null);
  }, [currentTool?.name]);

  async function runTool() {
    if (!currentTool) return;
    setRunning(true);
    setResult(null);
    try {
      let argsPayload: any = {};
      if (useRawJson) {
        try { argsPayload = argsText.trim() ? JSON.parse(argsText) : {}; }
        catch (e: any) { toast.error("invalid JSON in args"); setRunning(false); return; }
      } else {
        // Strip empty string / null values so we don't override server defaults.
        argsPayload = Object.fromEntries(
          Object.entries(argsForm).filter(([_, v]) => v !== "" && v !== null && v !== undefined),
        );
      }
      const res = await fetch("/api/connoisseur/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: currentTool.name, arguments: argsPayload }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setResult({ error: data?.error ?? `${res.status}`, isError: true });
        toast.error(data?.error ?? `tool ${currentTool.name} failed`);
      } else {
        setResult({ json: data.json, text: data.text, isError: data.isError });
      }
    } catch (err: any) {
      setResult({ error: err?.message ?? "request failed", isError: true });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ padding: "20px 28px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-fraunces)", fontSize: 28, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <BookOpen size={22} /> Research
          </h1>
          <p style={{ color: "var(--muted)", margin: "4px 0 0", fontSize: 13 }}>
            Live queries against the Connoisseur MCP — 1,213 Meta ads, peer benchmarks, voice atoms, compliance gates, consumer language.
          </p>
        </div>
        {serverUrl && (
          <code style={{ fontSize: 11, color: "var(--muted-2)", maxWidth: "60ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {serverUrl}
          </code>
        )}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18, alignItems: "start" }}>
        {/* Tool browser */}
        <aside className="card" style={{ padding: 12, position: "sticky", top: 18, maxHeight: "calc(100vh - 36px)", overflow: "auto" }}>
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search size={14} style={{ position: "absolute", top: 9, left: 9, color: "var(--muted-2)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tools.length} tools…`}
              style={{ width: "100%", padding: "7px 8px 7px 28px", fontSize: 12, borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)" }}
            />
          </div>
          {loadingTools && <div style={{ color: "var(--muted)", fontSize: 12 }}>loading tools…</div>}
          {!loadingTools && Object.keys(grouped).length === 0 && <div style={{ color: "var(--muted)", fontSize: 12 }}>no tools match</div>}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted-2)", padding: "4px 6px" }}>{group}</div>
              {items.map((t) => {
                const active = selected === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setSelected(t.name)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                      padding: "6px 8px", fontSize: 12, textAlign: "left",
                      background: active ? "var(--accent-bg)" : "transparent",
                      color: active ? "var(--accent)" : "var(--text)",
                      border: "none", borderRadius: 5, cursor: "pointer",
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    <ChevronRight size={12} style={{ opacity: active ? 1 : 0.3, flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Tool runner + result */}
        <section>
          {!currentTool ? (
            <div className="card" style={{ padding: 28, color: "var(--muted)", textAlign: "center" }}>
              Pick a tool from the left to run it.
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                  <div>
                    <code style={{ fontSize: 14, fontWeight: 600 }}>{currentTool.name}</code>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, whiteSpace: "pre-wrap" }}>
                      {currentTool.description?.split("\n").slice(0, 4).join("\n") || "(no description)"}
                    </div>
                  </div>
                  <button
                    onClick={runTool}
                    disabled={running}
                    className="btn btn-primary"
                    style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
                  >
                    <Play size={13} /> {running ? "Running…" : "Run"}
                  </button>
                </div>

                {/* Args input — form OR raw JSON */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--muted-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Arguments</div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                    <input type="checkbox" checked={useRawJson} onChange={(e) => setUseRawJson(e.target.checked)} />
                    raw JSON
                  </label>
                </div>
                {useRawJson ? (
                  <textarea
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    placeholder={JSON.stringify(exampleArgsFromSchema(currentTool.inputSchema), null, 2)}
                    rows={8}
                    spellCheck={false}
                    style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, padding: 10, borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)" }}
                  />
                ) : (
                  <ArgForm
                    schema={currentTool.inputSchema}
                    values={argsForm}
                    onChange={setArgsForm}
                  />
                )}
              </div>

              {result && <ResultView result={result} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Schema-driven form ────────────────────────────────────────────────────
// Connoisseur tool schemas commonly use `anyOf: [{type: "string"}, {type:"null"}]`
// for nullable fields and `enum` arrays for closed choices. We unwrap both.

function ArgForm({ schema, values, onChange }: { schema?: Tool["inputSchema"]; values: Record<string, any>; onChange: (v: Record<string, any>) => void }) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--muted)", padding: 8 }}>This tool takes no arguments — just hit Run.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {keys.map((k) => {
        const def = props[k];
        const baseType = inferBaseType(def);
        const enumOptions = inferEnum(def);
        const placeholder = def?.default !== undefined && def?.default !== null ? `default: ${JSON.stringify(def.default)}` : (def?.title ?? "");
        const label = (
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
            <span><code style={{ fontSize: 11 }}>{k}</code> {required.has(k) && <span style={{ color: "var(--danger, #c33)" }}>*</span>} <span style={{ color: "var(--muted-2)" }}>· {baseType}{enumOptions ? " enum" : ""}</span></span>
            {def?.description && <span style={{ color: "var(--muted-2)", textAlign: "right", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={def.description}>{def.description}</span>}
          </label>
        );
        return (
          <div key={k}>
            {label}
            {enumOptions ? (
              <select
                value={values[k] ?? ""}
                onChange={(e) => onChange({ ...values, [k]: e.target.value || undefined })}
                style={{ width: "100%", padding: 6, fontSize: 12, borderRadius: 5, border: "1px solid var(--line)", background: "var(--bg)" }}
              >
                <option value="">— any —</option>
                {enumOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : baseType === "boolean" ? (
              <select
                value={values[k] === undefined ? "" : String(values[k])}
                onChange={(e) => onChange({ ...values, [k]: e.target.value === "" ? undefined : e.target.value === "true" })}
                style={{ width: "100%", padding: 6, fontSize: 12, borderRadius: 5, border: "1px solid var(--line)", background: "var(--bg)" }}
              >
                <option value="">— null —</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : baseType === "number" || baseType === "integer" ? (
              <input
                type="number"
                value={values[k] ?? ""}
                placeholder={placeholder}
                onChange={(e) => onChange({ ...values, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}
                style={{ width: "100%", padding: 6, fontSize: 12, borderRadius: 5, border: "1px solid var(--line)", background: "var(--bg)" }}
              />
            ) : baseType === "object" || baseType === "array" ? (
              <textarea
                value={typeof values[k] === "string" ? values[k] : (values[k] === undefined ? "" : JSON.stringify(values[k]))}
                placeholder={`JSON ${baseType}`}
                rows={3}
                spellCheck={false}
                onChange={(e) => {
                  const v = e.target.value;
                  try { onChange({ ...values, [k]: v === "" ? undefined : JSON.parse(v) }); }
                  catch { onChange({ ...values, [k]: v }); /* keep raw string until valid */ }
                }}
                style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, monospace", padding: 6, fontSize: 11, borderRadius: 5, border: "1px solid var(--line)", background: "var(--bg)" }}
              />
            ) : (
              <input
                value={values[k] ?? ""}
                placeholder={placeholder}
                onChange={(e) => onChange({ ...values, [k]: e.target.value || undefined })}
                style={{ width: "100%", padding: 6, fontSize: 12, borderRadius: 5, border: "1px solid var(--line)", background: "var(--bg)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function inferBaseType(def: any): string {
  if (!def) return "string";
  if (def.type && def.type !== "null") return def.type;
  if (Array.isArray(def.anyOf)) {
    const nonNull = def.anyOf.find((d: any) => d.type && d.type !== "null");
    if (nonNull?.type) return nonNull.type;
  }
  if (def.enum) return "string";
  return "string";
}

function inferEnum(def: any): string[] | null {
  if (Array.isArray(def?.enum)) return def.enum.map(String);
  if (Array.isArray(def?.anyOf)) {
    const enumDef = def.anyOf.find((d: any) => Array.isArray(d.enum));
    if (enumDef?.enum) return enumDef.enum.map(String);
  }
  return null;
}

function exampleArgsFromSchema(schema?: Tool["inputSchema"]): Record<string, any> {
  const props = schema?.properties ?? {};
  const ex: Record<string, any> = {};
  for (const [k, def] of Object.entries(props)) {
    if ((def as any).default !== undefined) ex[k] = (def as any).default;
  }
  return ex;
}

// ── Result rendering ──────────────────────────────────────────────────────

function ResultView({ result }: { result: CallResult }) {
  if (result.isError || result.error) {
    return (
      <div className="card" style={{ padding: 14, borderColor: "var(--danger, #c33)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--danger, #c33)", fontSize: 13, marginBottom: 6 }}>
          <AlertCircle size={14} /> Tool error
        </div>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: 0 }}>{result.error || result.text || JSON.stringify(result.json, null, 2)}</pre>
      </div>
    );
  }
  const j = result.json;
  // Array-of-objects → table view; otherwise pretty-printed JSON.
  if (Array.isArray(j) && j.length > 0 && typeof j[0] === "object" && j[0] !== null) {
    const cols = uniqueKeys(j).slice(0, 10);
    return (
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
          {j.length} rows · {cols.length} cols shown
        </div>
        <div style={{ overflowX: "auto", maxHeight: 480 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg-2)", position: "sticky", top: 0 }}>
                {cols.map((c) => (
                  <th key={c} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--line)", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {j.slice(0, 200).map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                  {cols.map((c) => (
                    <td key={c} style={{ padding: "6px 10px", verticalAlign: "top", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String((row as any)[c] ?? "")}>
                      {renderCell((row as any)[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details style={{ borderTop: "1px solid var(--line)" }}>
          <summary style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>Raw JSON</summary>
          <pre style={{ margin: 0, padding: 14, fontSize: 11, maxHeight: 400, overflow: "auto" }}>{JSON.stringify(j, null, 2)}</pre>
        </details>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 14 }}>
      <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto", maxHeight: 560 }}>
        {j !== undefined && j !== null ? JSON.stringify(j, null, 2) : (result.text || "(no content)")}
      </pre>
    </div>
  );
}

function uniqueKeys(rows: any[]): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 50)) {
    if (r && typeof r === "object") for (const k of Object.keys(r)) seen.add(k);
  }
  return Array.from(seen);
}

function renderCell(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
