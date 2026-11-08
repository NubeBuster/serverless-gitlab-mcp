// Minimal read-only MCP (Streamable HTTP, stateless) proxy over a public GitLab REST API.
// No auth, no dependencies. GitLab host is fixed by the GITLAB_URL var (default invent.kde.org).

const PROTOCOL = "2025-06-18";

const projectProp = {
  type: "string",
  description: "Project path or numeric ID, e.g. 'graphics/digikam'",
};
const iidProp = { type: "integer", description: "Internal ID (the number in the URL)" };

const TOOLS = [
  {
    name: "get_merge_request",
    description: "Get a merge request: title, description, state, author, branches, labels.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp, iid: iidProp },
      required: ["project", "iid"],
    },
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}`,
  },
  {
    name: "get_merge_request_comments",
    description: "List discussion threads (comments and review notes) of a merge request.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp, iid: iidProp },
      required: ["project", "iid"],
    },
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}/discussions?per_page=100`,
  },
  {
    name: "get_merge_request_diff",
    description: "Get the file diffs of a merge request.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp, iid: iidProp },
      required: ["project", "iid"],
    },
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}/diffs?per_page=100`,
  },
  {
    name: "get_issue",
    description: "Get an issue: title, description, state, author, labels.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp, iid: iidProp },
      required: ["project", "iid"],
    },
    path: (a) => `/projects/${enc(a.project)}/issues/${a.iid}`,
  },
  {
    name: "get_issue_comments",
    description: "List discussion threads (comments) of an issue.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp, iid: iidProp },
      required: ["project", "iid"],
    },
    path: (a) => `/projects/${enc(a.project)}/issues/${a.iid}/discussions?per_page=100`,
  },
  {
    name: "list_issues",
    description: "Search/list issues of a project.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        search: { type: "string" },
        state: { type: "string", enum: ["opened", "closed", "all"] },
        labels: { type: "string", description: "Comma-separated labels" },
      },
      required: ["project"],
    },
    path: (a) => {
      const q = new URLSearchParams({ per_page: "30" });
      for (const k of ["search", "state", "labels"]) if (a[k]) q.set(k, a[k]);
      return `/projects/${enc(a.project)}/issues?${q}`;
    },
  },
  {
    name: "list_merge_requests",
    description: "Search/list merge requests of a project.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        search: { type: "string" },
        state: { type: "string", enum: ["opened", "closed", "merged", "all"] },
      },
      required: ["project"],
    },
    path: (a) => {
      const q = new URLSearchParams({ per_page: "30" });
      for (const k of ["search", "state"]) if (a[k]) q.set(k, a[k]);
      return `/projects/${enc(a.project)}/merge_requests?${q}`;
    },
  },
];

const enc = (s) => encodeURIComponent(String(s));
const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function callTool(env, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  for (const r of tool.inputSchema.required) {
    if (args?.[r] === undefined) throw new Error(`Missing argument: ${r}`);
  }
  const base = (env.GITLAB_URL || "https://invent.kde.org").replace(/\/$/, "");
  const res = await fetch(`${base}/api/v4${tool.path(args)}`, {
    headers: { accept: "application/json", "user-agent": "gitlab-mcp-proxy" },
  });
  const text = await res.text();
  return { content: [{ type: "text", text }], isError: !res.ok };
}

async function handle(env, msg) {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification
  switch (method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "gitlab-readonly-proxy", version: "0.1.0" },
      });
    case "ping":
      return rpc(id, {});
    case "tools/list":
      return rpc(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case "tools/call":
      try {
        return rpc(id, await callTool(env, params?.name, params?.arguments ?? {}));
      } catch (e) {
        return rpc(id, { content: [{ type: "text", text: String(e.message) }], isError: true });
      }
    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-expose-headers": "mcp-session-id",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== "/mcp") return new Response("gitlab-mcp-proxy: POST /mcp", { status: 404, headers: cors });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(rpcErr(null, -32700, "Parse error"), { status: 400, headers: cors });
    }
    const batch = Array.isArray(body);
    const out = (await Promise.all((batch ? body : [body]).map((m) => handle(env, m)))).filter(Boolean);
    if (out.length === 0) return new Response(null, { status: 202, headers: cors });
    return Response.json(batch ? out : out[0], { headers: cors });
  },
};
