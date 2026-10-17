import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { NVIDIA_MODEL } from "../src/nvidia-client.js";

const fakeKey = "route-test-fake-key-never-real";
const secretSentinel = "upstream-private-diagnostic-sentinel";

const validPlan = {
  summary: "Resolve the immediate blocker.",
  totalMinutes: 15,
  tasks: [{
    id: "t1",
    title: "Reproduce the login bug",
    minutes: 15,
    priority: "high",
    reason: "Confirm the failure before changing code.",
    dependsOn: [],
    category: "build"
  }]
};

function providerEnvelope(content) {
  return JSON.stringify({
    model: NVIDIA_MODEL,
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }]
  });
}

function providerResponse(text, { status = 200, chunkSize = 29, onCancel } = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel(reason) {
      onCancel?.(reason);
    }
  }, { highWaterMark: 0 });

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null; } },
    body
  };
}

async function withServer(options, run) {
  const server = createApp({
    allowedOrigins: ["http://localhost:5173"],
    rateLimit: { windowMs: 60_000, limit: 100 },
    ...options
  }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function postPlan(baseUrl, payload = { brainDump: "Reproduce and fix the login bug.", availableMinutes: 15, previousPlan: null }) {
  return fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

test("POST /api/plan calls the existing adapter and returns a validated plan", async () => {
  let providerCalls = 0;
  await withServer({
    env: { NVIDIA_API_KEY: fakeKey },
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer " + fakeKey);
      const upstreamRequest = JSON.parse(options.body);
      assert.equal(upstreamRequest.model, NVIDIA_MODEL);
      assert.equal(upstreamRequest.stream, false);
      assert.match(upstreamRequest.messages[1].content, /Available time: 15 minutes/);
      assert.match(upstreamRequest.messages[1].content, /Reproduce and fix the login bug/);
      assert.equal(JSON.stringify(upstreamRequest.messages).includes(fakeKey), false);
      return providerResponse(providerEnvelope(validPlan), { chunkSize: 5 });
    }
  }, async baseUrl => {
    const response = await postPlan(baseUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), validPlan);
  });
  assert.equal(providerCalls, 1);
});

test("invalid requests are rejected before any provider call", async () => {
  let providerCalls = 0;
  await withServer({
    env: { NVIDIA_API_KEY: fakeKey },
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("provider must not be called");
    }
  }, async baseUrl => {
    const response = await postPlan(baseUrl, { brainDump: " ", availableMinutes: 15 });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  });
  assert.equal(providerCalls, 0);
});

test("missing server credential fails safely without making a provider request", async () => {
  let providerCalls = 0;
  await withServer({
    env: { NVIDIA_API_KEY: "" },
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("provider must not be called");
    }
  }, async baseUrl => {
    const response = await postPlan(baseUrl);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: "AI_NOT_CONFIGURED", message: "NVIDIA provider is not configured." }
    });
  });
  assert.equal(providerCalls, 0);
});

test("upstream provider failure maps to a safe gateway error without exposing diagnostics", async () => {
  await withServer({
    env: { NVIDIA_API_KEY: fakeKey },
    fetchImpl: async () => providerResponse(
      JSON.stringify({ diagnostic: secretSentinel, key: fakeKey }),
      { status: 429 }
    )
  }, async baseUrl => {
    const response = await postPlan(baseUrl);
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error.code, "AI_RATE_LIMITED");
    assert.equal(JSON.stringify(payload).includes(secretSentinel), false);
    assert.equal(JSON.stringify(payload).includes(fakeKey), false);
  });
});

test("invalid model JSON is rejected with the stable model-output error", async () => {
  await withServer({
    env: { NVIDIA_API_KEY: fakeKey },
    fetchImpl: async () => providerResponse(providerEnvelope("prose " + secretSentinel + " {broken"))
  }, async baseUrl => {
    const response = await postPlan(baseUrl);
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(JSON.stringify(payload).includes(secretSentinel), false);
  });
});

test("route rejects dangling dependencies and cycles from provider output", async () => {
  const dangling = structuredClone(validPlan);
  dangling.tasks[0].dependsOn = ["missing"];
  const cyclic = {
    summary: "Cyclic output should be rejected.",
    totalMinutes: 2,
    tasks: [
      { ...validPlan.tasks[0], id: "t1", minutes: 1, dependsOn: ["t2"] },
      { ...validPlan.tasks[0], id: "t2", title: "Fix the bug", minutes: 1, dependsOn: ["t1"] }
    ]
  };

  for (const plan of [dangling, cyclic]) {
    await withServer({
      env: { NVIDIA_API_KEY: fakeKey },
      fetchImpl: async () => providerResponse(providerEnvelope(plan))
    }, async baseUrl => {
      const response = await postPlan(baseUrl);
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, "INVALID_MODEL_OUTPUT");
    });
  }
});

test("route rejects provider output whose scheduled minutes exceed available time", async () => {
  const overBudget = structuredClone(validPlan);
  overBudget.tasks[0].minutes = 16;
  overBudget.totalMinutes = 16;

  await withServer({
    env: { NVIDIA_API_KEY: fakeKey },
    fetchImpl: async () => providerResponse(providerEnvelope(overBudget))
  }, async baseUrl => {
    const response = await postPlan(baseUrl);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "INVALID_MODEL_OUTPUT");
  });
});

test("revision route passes only validated completed IDs and revision context into the planning prompt", async () => {
  const request = {
    brainDump: "Finish the remaining work.",
    availableMinutes: 15,
    previousPlan: {
      summary: "Previous plan",
      tasks: [{
        id: "t2",
        title: "Fix the login bug",
        minutes: 20,
        priority: "high",
        reason: "It blocks release.",
        dependsOn: ["t1"],
        category: "build"
      }],
      completedTaskIds: ["t1"],
      revisionContext: { reason: "blocked", blockers: [{ taskId: "t2", description: "Waiting for a test fix." }] }
    }
  };
  await withServer({
    env: { NVIDIA_API_KEY: fakeKey },
    fetchImpl: async (_url, options) => {
      const upstreamRequest = JSON.parse(options.body);
      const prompt = upstreamRequest.messages[1].content;
      assert.match(prompt, /completedTaskIds/);
      assert.match(prompt, /"t1"/);
      assert.match(prompt, /Waiting for a test fix/);
      const revisedPlan = {
        summary: "Continue with unfinished work.",
        totalMinutes: 15,
        tasks: [{ ...validPlan.tasks[0], id: "t2", dependsOn: ["t1"] }]
      };
      return providerResponse(providerEnvelope(revisedPlan));
    }
  }, async baseUrl => {
    const response = await postPlan(baseUrl, request);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).tasks[0].id, "t2");
  });
});
