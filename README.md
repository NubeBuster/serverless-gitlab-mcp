# serverless-gitlab-mcp

Read-only MCP server for GitLab (issues, merge requests, comments, diffs, files, search). It lets Gemini web app (and other MCP clients) read GitLab without OAuth. Deploy it as a Cloudflare Worker, or self-host it with Node/Docker.

Why: GitLab's built-in MCP endpoint requires OAuth, which Gemini web app's custom connector could not complete. This server needs none for public projects.

## Deploy

Choose either **Option A (Cloudflare Worker)** for zero-maintenance serverless hosting with automatic HTTPS, or **Option B (VPS / Docker)** to self-host on your own infrastructure.

### Option A: Cloudflare Worker (Serverless)

Best if you want a free, managed `https://*.workers.dev` endpoint without running any servers:

```bash
git clone https://github.com/NubeBuster/serverless-gitlab-mcp.git
cd serverless-gitlab-mcp
npx wrangler@latest login
npx wrangler@latest deploy
```

### Option B: VPS / Docker (Self-Hosted)

Best if you prefer self-hosting on your own Linux server or VPS. Run the one-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/NubeBuster/serverless-gitlab-mcp/main/install.sh | bash
```

To pass custom configuration via environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/NubeBuster/serverless-gitlab-mcp/main/install.sh | GITLAB_URL=https://gitlab.com PORT=8787 bash
```

The script builds the Docker image and starts it with `--restart unless-stopped` on `$PORT` (default `8787`).

- **Coolify / Docker Compose**: Deploy directly using [`docker-compose.yml`](docker-compose.yml).
- **Bare Node.js**: Run `node server.js` (requires Node 18+).
- **HTTPS Note**: Gemini web app requires an HTTPS endpoint. Workers provide HTTPS automatically. For VPS setups, put a reverse proxy (Caddy, Traefik, Nginx, or Coolify's proxy) in front.

## Use

Add `https://<host>/mcp` as the MCP server URL (Gemini → Connected apps → custom MCP server; leave Client ID and secret empty). For Claude Code: `claude mcp add --transport http gitlab https://<host>/mcp`.

## Configuration

Worker: `[vars]` in `wrangler.toml`, secrets via `wrangler secret put <NAME>`. Node/Docker: environment variables (see `.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITLAB_URL` | `https://invent.kde.org` | GitLab instance to read from |
| `GITLAB_TOKEN` | none | Token sent upstream (`read_api` scope) to read private projects |
| `MCP_AUTH_TOKEN` | none | When set, clients must send `Authorization: Bearer <token>` or `?token=<token>` |
| `ALLOWED_PROJECTS` | all | Comma-separated project path prefixes that may be read, e.g. `graphics/digikam,kde/` |
| `MAX_RESPONSE_BYTES` | 200000 | Cap on a single tool result |

If you set `GITLAB_TOKEN`, also set `MCP_AUTH_TOKEN` (and ideally `ALLOWED_PROJECTS`). Otherwise anyone with the URL can read everything that token can. Gemini's connector only takes a URL, so use the `?token=` form there; note that URLs can end up in logs.

## Tools

`get_merge_request`, `get_merge_request_comments`, `get_merge_request_diff`, `get_merge_request_commits`, `get_merge_request_pipelines`, `get_issue`, `get_issue_comments`, `list_issues`, `list_merge_requests`, `get_file`, `get_commit`, `search_project`. Projects are addressed by path (`graphics/digikam`) or numeric ID. All tools are read-only. `GET /health` returns `ok`.

## Development

`npm test` (no dependencies), `npm run dev` (wrangler), `npm start` (Node server).
