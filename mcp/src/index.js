// Remote MCP server (stateless streamable HTTP, JSON replies) for Cloudflare Workers.
// URL: https://<worker>/mcp/<MCP_TOKEN>
import { callTool, TOOLS } from "./tools.js";
import { makeStore, getServiceAccountToken } from "./firestore.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

// Compare every character, so timing does not reveal how much of the token matched
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Today's date in the UK as YYYY-MM-DD
export function ukToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function defaultCtx(env) {
  return {
    store: makeStore({
      projectId: env.FIREBASE_PROJECT_ID,
      householdId: env.HOUSEHOLD_ID,
      getToken: () => getServiceAccountToken(env.FIREBASE_SERVICE_ACCOUNT),
    }),
    today: ukToday(),
  };
}

// Handles one JSON-RPC message. Returns a reply object, or null for a notification.
async function dispatch(msg, ctx) {
  if (msg.id === undefined) return null; // notifications get no reply
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "food-tracker", version: "1.0.0" },
      });
    case "ping": return ok(id, {});
    case "tools/list": return ok(id, { tools: TOOLS });
    case "tools/call":
      try {
        const result = await callTool(params.name, params.arguments || {}, ctx);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (e) {
        // Tool errors go back to Claude as a readable result, not a crash
        return ok(id, { content: [{ type: "text", text: String((e && e.message) || e) }], isError: true });
      }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

export async function handle(request, env = {}, ctx) {
  const token = env.MCP_TOKEN;
  const path = new URL(request.url).pathname;
  if (!token || !sameText(path, `/mcp/${token}`)) return notFound();
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"));
  }
  if (!msg || typeof msg !== "object") return json(rpcError(null, -32600, "Invalid Request"));

  let use = ctx;
  if (!(ctx && ctx.store)) {
    try { use = defaultCtx(env); } catch (e) { return json(rpcError(msg.id ?? null, -32603, e.message)); }
  }
  const reply = await dispatch(msg, use);
  return reply ? json(reply) : new Response(null, { status: 202 });
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
