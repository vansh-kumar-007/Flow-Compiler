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
    assert.equal(response.status, 501);
    assert.equal((await response.json()).error.code, "PLANNING_NOT_IMPLEMENTED");
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
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error.code, "PLANNING_NOT_IMPLEMENTED");
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

