// Node/Bun entry point for self-hosting (VPS, Docker, Coolify). Reads config from process.env.
import { createServer } from "node:http";
import worker from "./src/index.js";

const port = Number(process.env.PORT) || 8787;

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(
      `http://${req.headers.host || "localhost"}${req.url}`,
      {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      },
    );
    const response = await worker.fetch(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500).end(String(e?.message ?? e));
  }
}).listen(port, () =>
  console.log(`serverless-gitlab-mcp listening on :${port}/mcp`),
);
