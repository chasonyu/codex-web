const { test } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("fs"),
  vm = require("vm"),
  http = require("http");
const root = require("node:path").resolve(__dirname, "..");
const s = fs.readFileSync(
  root + "/scratch/asar/.vite/build/main-CqEoQDOU.js",
  "utf8",
);
const start =
  s.indexOf("async function lYe(") >= 0
    ? s.indexOf("async function lYe(")
    : s.indexOf("function lYe(");
const end = s.indexOf("\nvar uYe", start);
const fn = vm.runInNewContext(
  "(" + s.slice(start, end < 0 ? undefined : end) + ")",
  {
    _: require(root + "/src/server/electron/index.js"),
    Headers,
    Response,
    ReadableStream,
    TransformStream,
    DOMException,
  },
);
test("preview transport contract", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/ok" });
      res.end();
    } else if (req.url === "/empty") {
      res.writeHead(204);
      res.end();
    } else if (req.url === "/slow") {
      /* cancellation must close this request */
    } else if (req.url === "/stream") {
      res.writeHead(200);
      res.write("start");
    } else if (req.url === "/large") {
      res.end(Buffer.alloc(2097153));
    } else {
      res.setHeader("x-probe", req.headers["x-probe"] || "");
      res.end("预览内容");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    await t.test("body and headers", async () => {
      const r = await fn(url + "/ok", { headers: { "x-probe": "yes" } });
      assert.equal(r.headers.get("x-probe"), "yes");
      assert.equal(await r.text(), "预览内容");
    });
    await t.test("redirect stays manual", async () => {
      const r = await fn(url + "/redirect", {});
      assert.equal(r.status, 302);
      assert.equal(r.headers.get("location"), "/ok");
      await r.body?.cancel();
    });
    await t.test("empty response", async () => {
      const r = await fn(url + "/empty", {});
      assert.equal(r.status, 204);
      assert.equal(await r.text(), "");
    });
    await t.test("cancel before request", async () => {
      const c = new AbortController();
      c.abort();
      await assert.rejects(fn(url + "/ok", { signal: c.signal }), {
        name: "AbortError",
      });
    });
    await t.test("cancel pending request", async () => {
      const c = new AbortController();
      const p = fn(url + "/slow", { signal: c.signal });
      const timer = setTimeout(() => c.abort(), 30);
      try {
        await assert.rejects(p, { name: "AbortError" });
      } finally {
        clearTimeout(timer);
      }
    });
    await t.test("cancel response stream", async () => {
      const c = new AbortController();
      const r = await fn(url + "/stream", { signal: c.signal });
      const p = r.text();
      c.abort();
      await assert.rejects(p, { name: "AbortError" });
    });
    await t.test("consumer cancels body", async () => {
      const r = await fn(url + "/stream", {});
      await r.body.cancel();
    });
    await t.test("2 MiB response limit", async () => {
      const r = await fn(url + "/large", {});
      await assert.rejects(r.text(), /too large/);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
