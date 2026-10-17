import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createApp, normalizeOrigin, parseAllowedOrigins, readRateLimitConfig } from "../src/app.js";
import { startServer } from "../src/server.js";

let server;
let baseUrl;

async function listen(app) {
  const instance = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    instance.once("listening", resolve);
    instance.once("error", reject);
  });
  return { server: instance, baseUrl: "http://127.0.0.1:" + instance.address().port };
}

async function close(instance) {
  if (!instance) return;
  await new Promise((resolve, reject) => {
    instance.close(error => error ? reject(error) : resolve());
  });
}

before(async () => {
  server = createApp({ env: { NVIDIA_API_KEY: "" }, allowedOrigin: "http://localhost:5173", rateLimit: { windowMs: 60_000, limit: 1_000 } }).listen(0, "127.0.0.1");
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

test("plan endpoint reports missing server-side provider configuration without calling NVIDIA", async () => {
  const response = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The source starter sends previousPlan: null for initial compilation.
    body: JSON.stringify({ brainDump: "test", availableMinutes: 30, previousPlan: null })
  });
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.error.code, "AI_NOT_CONFIGURED");
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

test("plan endpoint rejects invalid brain dumps and time budgets", async () => {
  const invalidPayloads = [
    {},
    { brainDump: "   ", availableMinutes: 30 },
    { brainDump: 42, availableMinutes: 30 },
    { brainDump: "valid task", availableMinutes: 4 },
    { brainDump: "valid task", availableMinutes: 721 },
    { brainDump: "valid task", availableMinutes: 5.5 },
    { brainDump: "valid task", availableMinutes: "30" },
    { brainDump: "x".repeat(5001), availableMinutes: 30 }
  ];

  for (const payload of invalidPayloads) {
    const response = await fetch(baseUrl + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 100));
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  }
});

test("plan endpoint accepts both inclusive available-time boundaries", async () => {
  for (const availableMinutes of [5, 720]) {
    const response = await fetch(baseUrl + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brainDump: "Finish one concrete task.", availableMinutes })
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, "AI_NOT_CONFIGURED");
  }
});

test("plan endpoint accepts the source-compatible previousPlan revision shape", async () => {
  const response = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brainDump: "Resolve the blocker and continue.",
      availableMinutes: 5,
      previousPlan: {
        summary: "Existing plan",
        tasks: [{
          id: "t2",
          title: "Resolve the build blocker",
          minutes: 10,
          priority: "high",
          reason: "The release depends on this fix.",
          dependsOn: ["t1"],
          category: "build"
        }],
        completedTaskIds: ["t1"],
        revisionContext: {
          reason: "blocked",
          blockers: [{
            taskId: "t2",
            description: "Build is waiting for a failing test to be repaired."
          }]
        }
      }
    })
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "AI_NOT_CONFIGURED");
});

test("plan endpoint rejects malformed revision context and dangling prior dependencies", async () => {
  const validTask = {
    id: "t2",
    title: "Resolve the build blocker",
    minutes: 10,
    priority: "high",
    reason: "The release depends on this fix.",
    dependsOn: ["missing"],
    category: "build"
  };
  const invalidPayloads = [
    {
      brainDump: "Revise my plan",
      availableMinutes: 30,
      previousPlan: { tasks: [], completedTaskIds: [] }
    },
    {
      brainDump: "Revise my plan",
      availableMinutes: 30,
      previousPlan: { tasks: [validTask], completedTaskIds: [] }
    },
    {
      brainDump: "Revise my plan",
      availableMinutes: 30,
      previousPlan: {
        tasks: [{ ...validTask, dependsOn: [] }],
        completedTaskIds: [],
        revisionContext: {
          reason: "blocked",
          blockers: [{ taskId: "not-in-plan", description: "Missing task." }]
        }
      }
    },
    {
      brainDump: "Revise my plan",
      availableMinutes: 30,
      previousPlan: {
        tasks: [{ ...validTask, dependsOn: [] }],
        completedTaskIds: ["t2"]
      }
    },
    {
      brainDump: "Revise my plan",
      availableMinutes: 30,
      previousPlan: {
        tasks: [{ ...validTask, dependsOn: [] }],
        completedTaskIds: Array.from({ length: 20 }, (_value, index) => "done" + (index + 1))
      }
    },
    {
      brainDump: "Revise my plan",
      availableMinutes: 30,
      previousPlan: {
        tasks: [{ ...validTask, dependsOn: [] }],
        completedTaskIds: [],
        totalMinutes: 0
      }
    }
  ];

  for (const payload of invalidPayloads) {
    const response = await fetch(baseUrl + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  }
});

test("plan endpoint rejects unsupported top-level fields such as client-supplied credentials", async () => {
  const response = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brainDump: "Plan a task",
      availableMinutes: 30,
      NVIDIA_API_KEY: "not-a-real-key"
    })
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "INVALID_REQUEST");
  assert.equal(payload.error.message.includes("not-a-real-key"), false);
});



test("rate limiting allows requests up to the configured cap and blocks the next one", async () => {
  const started = await listen(createApp({ allowedOrigins: ["http://localhost:5173"], rateLimit: { windowMs: 60_000, limit: 2 } }));
  try {
    const first = await fetch(started.baseUrl + "/api/health");
    const second = await fetch(started.baseUrl + "/api/health");
    const third = await fetch(started.baseUrl + "/api/health");
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.deepEqual(await third.json(), { error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many API requests. Please try again later." } });
    assert.equal(third.headers.get("ratelimit-limit"), "2");
    assert.equal(third.headers.get("ratelimit-remaining"), "0");
    assert.ok(Number(third.headers.get("retry-after")) >= 1);
  } finally { await close(started.server); }
});

test("rate limit window resets using a controllable clock and isolated app instance", async () => {
  let clock = 1_000_000;
  const started = await listen(createApp({ allowedOrigins: ["http://localhost:5173"], rateLimit: { windowMs: 1_000, limit: 1 }, now: () => clock }));
  try {
    assert.equal((await fetch(started.baseUrl + "/api/health")).status, 200);
    assert.equal((await fetch(started.baseUrl + "/api/health")).status, 429);
    clock += 1_000;
    assert.equal((await fetch(started.baseUrl + "/api/health")).status, 200);
  } finally { await close(started.server); }
});

test("rate-limit identity ignores spoofed forwarding headers when proxy trust is disabled", async () => {
  const started = await listen(createApp({ allowedOrigins: ["http://localhost:5173"], rateLimit: { windowMs: 60_000, limit: 1 } }));
  try {
    assert.equal((await fetch(started.baseUrl + "/api/health", { headers: { "X-Forwarded-For": "198.51.100.1" } })).status, 200);
    assert.equal((await fetch(started.baseUrl + "/api/health", { headers: { "X-Forwarded-For": "203.0.113.9" } })).status, 429);
  } finally { await close(started.server); }
});

test("rate-limit middleware applies to all API paths but not non-API routes", async () => {
  const started = await listen(createApp({ allowedOrigins: ["http://localhost:5173"], rateLimit: { windowMs: 60_000, limit: 1 } }));
  try {
    assert.equal((await fetch(started.baseUrl + "/not-a-route")).status, 404);
    const plan = await fetch(started.baseUrl + "/api/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brainDump: "a valid input", availableMinutes: 30 })
    });
    assert.equal(plan.status, 500);
    assert.equal((await plan.json()).error.code, "AI_NOT_CONFIGURED");
    assert.equal((await fetch(started.baseUrl + "/api/health")).status, 429);
  } finally { await close(started.server); }
});

test("unset rate-limit settings use safe documented defaults", () => {
  assert.deepEqual(readRateLimitConfig({}), { windowMs: 60_000, limit: 10 });
});

test("configuration accepts supported minimum and maximum rate-limit settings", () => {
  assert.deepEqual(readRateLimitConfig({ API_RATE_LIMIT_WINDOW_MS: "1000", API_RATE_LIMIT_MAX: "1" }), { windowMs: 1_000, limit: 1 });
  assert.deepEqual(readRateLimitConfig({ API_RATE_LIMIT_WINDOW_MS: "86400000", API_RATE_LIMIT_MAX: "10000" }), { windowMs: 86_400_000, limit: 10_000 });
});

test("configuration rejects malformed and out-of-range explicit rate-limit values", () => {
  for (const env of [
    { API_RATE_LIMIT_WINDOW_MS: "", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "0", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "1000", API_RATE_LIMIT_MAX: "" },
    { API_RATE_LIMIT_WINDOW_MS: "1000", API_RATE_LIMIT_MAX: "0" },
    { API_RATE_LIMIT_WINDOW_MS: "999", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "86400001", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "1000", API_RATE_LIMIT_MAX: "10001" },
    { API_RATE_LIMIT_WINDOW_MS: "1e3", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "1000.5", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "-1000", API_RATE_LIMIT_MAX: "10" },
    { API_RATE_LIMIT_WINDOW_MS: "abc", API_RATE_LIMIT_MAX: "10" }
  ]) assert.throws(() => readRateLimitConfig(env));
});

test("origin configuration normalizes canonical origins and rejects unsafe values", () => {
  assert.equal(normalizeOrigin("https://Example.com:443/"), "https://example.com");
  assert.deepEqual(parseAllowedOrigins("http://localhost:5173, https://example.com"), ["http://localhost:5173", "https://example.com"]);
  for (const value of [
    "*", "https://*.example.com", "https://example.com/path", "https://example.com?query=1",
    "https://user:password@example.com", "ftp://example.com", "http://example.com",
    "https://example.com,", "https://example.com,https://example.com/"
  ]) assert.throws(() => parseAllowedOrigins(value), value);
});

test("app rejects unsafe rate-limit and origin configuration at creation/startup", () => {
  assert.throws(() => createApp({ env: { API_RATE_LIMIT_WINDOW_MS: "10", API_RATE_LIMIT_MAX: "10", APP_ORIGINS: "http://localhost:5173" } }));
  assert.throws(() => createApp({ env: { API_RATE_LIMIT_WINDOW_MS: "60000", API_RATE_LIMIT_MAX: "10", APP_ORIGINS: "*" } }));
});

test("rate-limit errors use only the stable safe envelope and do not disclose secrets or stacks", async () => {
  const started = await listen(createApp({ allowedOrigins: ["http://localhost:5173"], rateLimit: { windowMs: 60_000, limit: 1 } }));
  try {
    await fetch(started.baseUrl + "/api/health");
    const response = await fetch(started.baseUrl + "/api/health", { headers: { Origin: "http://localhost:5173" } });
    const body = await response.text();
    assert.equal(response.status, 429);
    assert.deepEqual(Object.keys(JSON.parse(body)), ["error"]);
    assert.deepEqual(Object.keys(JSON.parse(body).error).sort(), ["code", "message"]);
    assert.equal(/stack|NVIDIA_API_KEY|password|token|secret/i.test(body), false);
  } finally { await close(started.server); }
});

test("disallowed origins are not reflected; allowed and denied preflight behavior is explicit", async () => {
  const started = await listen(createApp({ allowedOrigins: ["https://app.example.com"] }));
  try {
    const denied = await fetch(started.baseUrl + "/api/health", { headers: { Origin: "https://app.example.com.attacker.example" } });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);

    const allowedPreflight = await fetch(started.baseUrl + "/api/plan", {
      method: "OPTIONS",
      headers: { Origin: "https://app.example.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,accept" }
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.match(allowedPreflight.headers.get("access-control-allow-methods"), /POST/);
    assert.match(allowedPreflight.headers.get("access-control-allow-headers"), /Content-Type/i);
    assert.equal(allowedPreflight.headers.get("access-control-allow-credentials"), null);

    const deniedPreflight = await fetch(started.baseUrl + "/api/plan", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example", "Access-Control-Request-Method": "POST" }
    });
    assert.equal(deniedPreflight.headers.get("access-control-allow-origin"), null);
  } finally { await close(started.server); }
});

test("no-Origin requests work without cross-origin grants", async () => {
  const response = await fetch(baseUrl + "/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
