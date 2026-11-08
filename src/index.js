// Read-only MCP (Streamable HTTP, stateless) server over the GitLab REST API.
// Zero dependencies; plain Fetch API, so it runs on Cloudflare Workers, Bun, Deno and Node 18+.
//
// Configuration (Worker vars/secrets, or process env under Node):
//   GITLAB_URL        GitLab instance, default https://invent.kde.org
//   GITLAB_TOKEN      optional upstream token (sent as PRIVATE-TOKEN) to read private projects
//   MCP_AUTH_TOKEN    optional; when set, clients must send `Authorization: Bearer <token>`
//                     or append `?token=<token>` to the URL (for clients that only take a URL)
//   ALLOWED_PROJECTS  optional comma-separated project path prefixes, e.g. "graphics/digikam,kde/"
//   MAX_RESPONSE_BYTES  optional cap on a tool result, default 200000

const PROTOCOL = "2025-06-18";
const DEFAULT_MAX_BYTES = 200_000;

const enc = (s) => encodeURIComponent(String(s));
const projectProp = {
  type: "string",
  description: "Project path or numeric ID, e.g. 'graphics/digikam'",
};
const iidProp = { type: "integer", description: "Internal ID (the number in the URL)" };
const needIid = { type: "object", properties: { project: projectProp, iid: iidProp }, required: ["project", "iid"] };

function query(a, keys, base = {}) {
  const q = new URLSearchParams(base);
  for (const k of keys) if (a[k] !== undefined && a[k] !== "") q.set(k, a[k]);
  return q;
}

const TOOLS = [
  {
    name: "get_merge_request",
    description: "Get a merge request: title, description, state, author, branches, labels.",
    inputSchema: needIid,
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}`,
  },
  {
    name: "get_merge_request_comments",
    description: "List discussion threads (comments and review notes) of a merge request.",
    inputSchema: needIid,
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}/discussions?per_page=100`,
  },
  {
    name: "get_merge_request_diff",
    description: "Get the file diffs of a merge request.",
    inputSchema: needIid,
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}/diffs?per_page=100`,
  },
  {
    name: "get_merge_request_commits",
    description: "List the commits of a merge request.",
    inputSchema: needIid,
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}/commits?per_page=100`,
  },
  {
    name: "get_merge_request_pipelines",
    description: "List CI pipelines of a merge request (status, ref, sha).",
    inputSchema: needIid,
    path: (a) => `/projects/${enc(a.project)}/merge_requests/${a.iid}/pipelines`,
  },
  {
    name: "get_issue",
    description: "Get an issue: title, description, state, author, labels.",
    inputSchema: needIid,
    path: (a) => `/projects/${enc(a.project)}/issues/${a.iid}`,
  },
  {
    name: "get_issue_comments",
    description: "List discussion threads (comments) of an issue.",
    inputSchema: needIid,
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
        page: { type: "integer" },
      },
      required: ["project"],
    },
    path: (a) => `/projects/${enc(a.project)}/issues?${query(a, ["search", "state", "labels", "page"], { per_page: "30" })}`,
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
        page: { type: "integer" },
      },
      required: ["project"],
    },
    path: (a) => `/projects/${enc(a.project)}/merge_requests?${query(a, ["search", "state", "page"], { per_page: "30" })}`,
  },
  {
    name: "get_file",
    description: "Get the raw contents of a repository file at a ref (branch, tag or sha).",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        path: { type: "string", description: "File path in the repository" },
        ref: { type: "string", description: "Branch, tag or commit; default branch if omitted" },
      },
      required: ["project", "path"],
    },
    path: (a) => `/projects/${enc(a.project)}/repository/files/${enc(a.path)}/raw${a.ref ? `?ref=${enc(a.ref)}` : ""}`,
    raw: true,
  },
  {
    name: "get_commit",
    description: "Get a commit (message, author, stats) by sha or ref.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp, sha: { type: "string" } },
      required: ["project", "sha"],
    },
    path: (a) => `/projects/${enc(a.project)}/repository/commits/${enc(a.sha)}`,
  },
  {
    name: "search_project",
    description: "Search a project's issues, merge requests, commits or code (blobs).",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        scope: { type: "string", enum: ["issues", "merge_requests", "commits", "blobs", "notes"] },
        search: { type: "string" },
      },
      required: ["project", "scope", "search"],
    },
    path: (a) => `/projects/${enc(a.project)}/search?${query(a, ["scope", "search"], { per_page: "20" })}`,
  },
];

const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function authorized(request, url, env) {
  if (!env.MCP_AUTH_TOKEN) return true;
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token") || "";
  return constantTimeEqual(given, env.MCP_AUTH_TOKEN);
}

function projectAllowed(env, project) {
  if (!env.ALLOWED_PROJECTS) return true;
  const p = String(project).replace(/^\/+/, "");
  return env.ALLOWED_PROJECTS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((prefix) => p === prefix || p.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

async function callTool(env, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  for (const r of tool.inputSchema.required) {
    if (args?.[r] === undefined) throw new Error(`Missing argument: ${r}`);
  }
  if (!projectAllowed(env, args.project)) throw new Error("Project not allowed by ALLOWED_PROJECTS");

  const base = (env.GITLAB_URL || "https://invent.kde.org").replace(/\/$/, "");
  const headers = { accept: tool.raw ? "text/plain" : "application/json", "user-agent": "serverless-gitlab-mcp" };
  if (env.GITLAB_TOKEN) headers["PRIVATE-TOKEN"] = env.GITLAB_TOKEN;

  const res = await fetch(`${base}/api/v4${tool.path(args)}`, { headers });
  let text = await res.text();
  const max = Number(env.MAX_RESPONSE_BYTES) || DEFAULT_MAX_BYTES;
  if (text.length > max) text = `${text.slice(0, max)}\n\n[truncated: ${text.length - max} more characters]`;
  return { content: [{ type: "text", text }], isError: !res.ok };
}

async function handle(env, msg) {
  const { id, method, params } = msg ?? {};
  if (id === undefined) return null; // notification
  switch (method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "serverless-gitlab-mcp", version: "0.2.0" },
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
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return new Response("ok", { headers: cors });
    if (url.pathname !== "/mcp") return new Response("serverless-gitlab-mcp: POST /mcp", { status: 404, headers: cors });
    if (!authorized(request, url, env)) {
      return new Response("Unauthorized", { status: 401, headers: { ...cors, "www-authenticate": "Bearer" } });
    }
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
