# serverless-gitlab-mcp

Read-only MCP server for GitLab (issues, merge requests, comments, diffs, files, search). It lets Gemini (and other MCP clients) read GitLab without OAuth. Deploy it as a Cloudflare Worker, or self-host it with Node/Docker.

Why: GitLab's built-in MCP endpoint requires OAuth, which Gemini's custom connector could not complete. This server needs none for public projects.

## Deploy

**Cloudflare Worker**

```
npx wrangler@latest login
npx wrangler@latest deploy
```

**VPS / Docker / Coolify**

```
git clone <this-repo> && cd serverless-gitlab-mcp && ./install.sh
```

`install.sh` builds the image and runs it with `--restart unless-stopped` on `$PORT` (default 8787). Config goes in as env vars, e.g. `GITLAB_URL=https://gitlab.com ./install.sh`. For Coolify, deploy the repo as a Docker Compose resource (`docker-compose.yml`). Gemini requires HTTPS, so put a reverse proxy in front (Coolify's does this for you). Without Docker: `node server.js` (Node 18+).

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
