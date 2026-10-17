import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { startServer } from "../src/server.js";

let server;
let baseUrl;

before(async () => {
  server = createApp({ allowedOrigin: "http://localhost:5173" }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("health endpoint returns the service status", async () => {
  const response = await fetch(baseUrl + "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "flow-compiler-api"
  });
});

test("plan endpoint is explicit that AI planning is not yet implemented", async () => {
  const response = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brainDump: "test", availableMinutes: 30 })
  });
  assert.equal(response.status, 501);
  const payload = await response.json();
  assert.equal(payload.error.code, "PLANNING_NOT_IMPLEMENTED");
});

test("unknown routes return a stable JSON 404", async () => {
  const response = await fetch(baseUrl + "/not-a-route");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("malformed JSON returns a safe 400 response", async () => {
  const response = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json"
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_JSON");
});

test("oversized JSON is rejected before route handling", async () => {
  const body = JSON.stringify({ content: "x".repeat(22 * 1024) });
  const response = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});

test("health response includes configured CORS origin without credentials", async () => {
  const response = await fetch(baseUrl + "/api/health", {
    headers: { Origin: "http://localhost:5173" }
  });
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("server bootstrap binds a port and serves the health route", async () => {
  const started = startServer({ port: 0, host: "127.0.0.1" });
  await once(started, "listening");
  try {
    const response = await fetch("http://127.0.0.1:" + started.address().port + "/api/health");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  } finally {
    await new Promise((resolve, reject) => started.close(error => error ? reject(error) : resolve()));
  }
});
