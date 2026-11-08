import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const post = (body, env = {}, path = "/mcp", headers = {}) =>
  worker.fetch(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );

const call = (name, args) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

test("initialize and tools/list", async () => {
  const init = await (
    await post({ jsonrpc: "2.0", id: 1, method: "initialize" })
  ).json();
  assert.equal(init.result.serverInfo.name, "serverless-gitlab-mcp");
  const list = await (
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  ).json();
  assert.ok(list.result.tools.some((t) => t.name === "get_merge_request"));
});

test("notification gets 202", async () => {
  const res = await post({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(res.status, 202);
});

test("MCP_AUTH_TOKEN enforced via header and query", async () => {
  const env = { MCP_AUTH_TOKEN: "s3cret" };
  const msg = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal((await post(msg, env)).status, 401);
  assert.equal(
    (await post(msg, env, "/mcp", { authorization: "Bearer wrong" })).status,
    401,
  );
  assert.equal(
    (await post(msg, env, "/mcp", { authorization: "Bearer s3cret" })).status,
    200,
  );
  assert.equal((await post(msg, env, "/mcp?token=s3cret")).status, 200);
});

test("ALLOWED_PROJECTS rejects other projects without calling GitLab", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => assert.fail("must not fetch");
  try {
    const env = { ALLOWED_PROJECTS: "graphics/digikam" };
    const res = await (
      await post(call("get_issue", { project: "other/proj", iid: 1 }), env)
    ).json();
    assert.equal(res.result.isError, true);
  } finally {
    globalThis.fetch = real;
  }
});

test("tool call hits GitLab with token, truncates", async () => {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response("x".repeat(50), { status: 200 });
  };
  try {
    const env = {
      GITLAB_URL: "https://gl.example/",
      GITLAB_TOKEN: "tok",
      MAX_RESPONSE_BYTES: "10",
    };
    const res = await (
      await post(call("get_merge_request", { project: "a/b", iid: 7 }), env)
    ).json();
    assert.equal(
      seen.url,
      "https://gl.example/api/v4/projects/a%2Fb/merge_requests/7",
    );
    assert.equal(seen.init.headers["PRIVATE-TOKEN"], "tok");
    assert.match(res.result.content[0].text, /truncated/);
  } finally {
    globalThis.fetch = real;
  }
});

test("anonymous 401 on discussions falls back to web discussions.json", async () => {
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return String(url).includes("/api/v4/")
      ? new Response("no", { status: 401 })
      : new Response("[]", { status: 200 });
  };
  try {
    const env = { GITLAB_URL: "https://gl.example" };
    const res = await (
      await post(
        call("get_merge_request_comments", { project: "a/b", iid: 5 }),
        env,
      )
    ).json();
    assert.equal(
      urls[1],
      "https://gl.example/a/b/-/merge_requests/5/discussions.json",
    );
    assert.equal(res.result.isError, false);
    urls.length = 0;
    await post(call("get_merge_request_comments", { project: "a/b", iid: 5 }), {
      ...env,
      GITLAB_TOKEN: "t",
    });
    assert.equal(urls.length, 1, "no fallback when a token is configured");
  } finally {
    globalThis.fetch = real;
  }
});

test("health and unknown path", async () => {
  assert.equal(
    (await worker.fetch(new Request("http://x/health"), {})).status,
    200,
  );
  assert.equal(
    (await worker.fetch(new Request("http://x/nope"), {})).status,
    404,
  );
});
