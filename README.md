# serverless-gitlab-mcp

Read-only MCP server for public GitLab projects (issues, merge requests, comments, diffs), deployed as a Cloudflare Worker. It lets Gemini (and other MCP clients) read GitLab without OAuth or self-hosting.

## Deploy

```
npx wrangler@latest login
npx wrangler@latest deploy
```

Set `GITLAB_URL` in `wrangler.toml` to your GitLab instance (default `https://invent.kde.org`; use `https://gitlab.com` for gitlab.com).

## Use

Add `https://<worker>.<subdomain>.workers.dev/mcp` as the MCP server URL (e.g. Gemini → Connected apps → custom MCP server). Leave Client ID and secret empty.

Tools: `get_merge_request`, `get_merge_request_comments`, `get_merge_request_diff`, `get_issue`, `get_issue_comments`, `list_issues`, `list_merge_requests`. Projects are addressed by path (`graphics/digikam`) or numeric ID.

Only public data is readable: requests carry no credentials, and the endpoint itself is unauthenticated.
