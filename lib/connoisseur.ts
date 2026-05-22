// Connoisseur MCP client — hosted at the Railway URL below. Exposes the
// AshwaMag creative-intelligence corpus (1,213 Meta ads + peer benchmarks +
// voice atoms + compliance gates + Reddit-sourced consumer language) through
// 30 typed tools. We talk to it via MCP "streamable HTTP" transport:
//
//   POST /mcp   { jsonrpc: "2.0", method, params, id }
//   Accept: text/event-stream
//   ←   event: message\ndata: { ...JSON-RPC response }
//
// The server returns an `Mcp-Session-Id` header on initialize; subsequent
// requests must echo it back. Sessions can be re-established on demand.
//
// This file is intentionally framework-free — usable from any API route or
// server component. It uses one shared session per server process.

const DEFAULT_URL = "https://connoisseur-mcp-production.up.railway.app/mcp";

export function connoisseurUrl(): string {
  return process.env.CONNOISSEUR_MCP_URL || DEFAULT_URL;
}

export function connoisseurConfigured(): boolean {
  return Boolean(connoisseurUrl());
}

type Tool = {
  name: string;
  description?: string;
  inputSchema?: any;
};

type ToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: any };

export type ToolCallResult = {
  content: ToolCallContent[];
  isError?: boolean;
  structuredContent?: any;
};

const g = globalThis as unknown as {
  __connoisseurSession?: { url: string; sessionId: string; reqId: number };
};

// --- low-level transport ---------------------------------------------------

// Parse a streamable-HTTP SSE body. Server returns one or more
// `event: <type>\ndata: <json>\n\n` frames; we want the *first* `message`
// frame whose JSON-RPC `id` matches the request, ignoring server-initiated
// notifications (which arrive with no `id`).
function parseSseForResponse(raw: string, expectedId: number): any | null {
  const frames = raw.split(/\n\n+/);
  for (const frame of frames) {
    const lines = frame.split(/\r?\n/);
    let eventType = "message";
    let dataLine: string | null = null;
    for (const ln of lines) {
      if (ln.startsWith("event:")) eventType = ln.slice(6).trim();
      else if (ln.startsWith("data:")) dataLine = (dataLine ?? "") + ln.slice(5).trim();
    }
    if (eventType !== "message" || !dataLine) continue;
    try {
      const parsed = JSON.parse(dataLine);
      if (parsed && typeof parsed === "object" && "id" in parsed && parsed.id === expectedId) {
        return parsed;
      }
    } catch {
      // ignore malformed frame
    }
  }
  return null;
}

async function rawCall(method: string, params: any | undefined, opts?: { sessionId?: string; expectResponse?: boolean }): Promise<{ result?: any; error?: any; sessionId?: string }> {
  const url = connoisseurUrl();
  const reqId = (g.__connoisseurSession?.reqId ?? 0) + 1;
  if (g.__connoisseurSession) g.__connoisseurSession.reqId = reqId;

  const body: any = { jsonrpc: "2.0", method };
  if (opts?.expectResponse !== false) body.id = reqId;
  if (params !== undefined) body.params = params;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (opts?.sessionId) headers["Mcp-Session-Id"] = opts.sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const newSessionId = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id") || undefined;

  // Notifications: server returns 202 with empty body, no response expected.
  if (opts?.expectResponse === false) {
    if (res.status >= 400) {
      const t = await res.text();
      throw new Error(`Connoisseur MCP ${res.status} on ${method}: ${t.slice(0, 200)}`);
    }
    return { sessionId: newSessionId };
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Connoisseur MCP ${res.status} on ${method}: ${t.slice(0, 300)}`);
  }

  const text = await res.text();
  const parsed = parseSseForResponse(text, reqId);
  if (!parsed) {
    // Some servers return plain JSON when client didn't open the SSE channel.
    try {
      const direct = JSON.parse(text);
      if (direct?.id === reqId) return { result: direct.result, error: direct.error, sessionId: newSessionId };
    } catch { /* fall through */ }
    throw new Error(`Connoisseur MCP returned no matching response for ${method} (body: ${text.slice(0, 200)})`);
  }
  return { result: parsed.result, error: parsed.error, sessionId: newSessionId };
}

// --- session lifecycle ----------------------------------------------------

async function ensureSession(): Promise<string> {
  const url = connoisseurUrl();
  if (g.__connoisseurSession?.url === url && g.__connoisseurSession.sessionId) {
    return g.__connoisseurSession.sessionId;
  }
  // Fresh initialize handshake.
  const { result, error, sessionId } = await rawCall(
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "content-hackathon-dashboard", version: "1.0" },
    },
  );
  if (error) throw new Error(`Connoisseur MCP initialize failed: ${error.message || JSON.stringify(error)}`);
  if (!sessionId) throw new Error("Connoisseur MCP did not return Mcp-Session-Id on initialize");
  g.__connoisseurSession = { url, sessionId, reqId: 0 };
  // Best-effort initialized notification — some servers require it before tool calls.
  await rawCall("notifications/initialized", {}, { sessionId, expectResponse: false }).catch(() => {});
  return sessionId;
}

function dropSession() {
  g.__connoisseurSession = undefined;
}

// One-retry wrapper: if the cached session has expired (404 / session not
// found), drop it and re-init. Keeps long-running server processes alive.
async function withSession<T>(fn: (sid: string) => Promise<T>): Promise<T> {
  let sid = await ensureSession();
  try {
    return await fn(sid);
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (/session/i.test(msg) || /404/.test(msg) || /400/.test(msg)) {
      dropSession();
      sid = await ensureSession();
      return await fn(sid);
    }
    throw err;
  }
}

// --- public API ------------------------------------------------------------

export async function listTools(): Promise<Tool[]> {
  return withSession(async (sid) => {
    const { result, error } = await rawCall("tools/list", {}, { sessionId: sid });
    if (error) throw new Error(`tools/list error: ${error.message || JSON.stringify(error)}`);
    return (result?.tools ?? []) as Tool[];
  });
}

export async function callTool(name: string, args: Record<string, any> = {}): Promise<ToolCallResult> {
  return withSession(async (sid) => {
    const { result, error } = await rawCall("tools/call", { name, arguments: args }, { sessionId: sid });
    if (error) throw new Error(`tools/call (${name}) error: ${error.message || JSON.stringify(error)}`);
    return result as ToolCallResult;
  });
}

// Many Connoisseur tools return a single text content part containing JSON.
// This helper unwraps that for callers who don't care about MCP framing.
export function extractToolJson(result: ToolCallResult): any {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const txt = result.content?.find((c) => c.type === "text") as { type: "text"; text: string } | undefined;
  if (!txt) return null;
  try {
    return JSON.parse(txt.text);
  } catch {
    return txt.text;
  }
}

export function extractToolText(result: ToolCallResult): string {
  return result.content
    ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n\n") ?? "";
}
