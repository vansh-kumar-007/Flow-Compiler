import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { NVIDIA_MODEL } from "../src/nvidia-client.js";

const fakeKey = "route-test-fake-key-never-real";
const fakeAccessToken = "a".repeat(43);
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
    ...options,
    env: {
      FLOW_COMPILER_ACCESS_TOKEN: fakeAccessToken,
      ...(options.env ?? {})
    }
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
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + fakeAccessToken
    },
    body: JSON.stringify(payload)
  });
}

test("missing, invalid, and malformed credentials all return the same safe 401 before provider invocation", async () => {
  let providerCalls = 0;
  const configuredToken = "b".repeat(43);
  const cases = [
    { name: "missing", authorization: undefined },
    { name: "wrong token", authorization: "Bearer " + "c".repeat(43) },
    { name: "wrong scheme", authorization: "Basic " + configuredToken },
    { name: "malformed bearer", authorization: "Bearer short.token" },
    { name: "ambiguous combined credentials", authorization: "Bearer " + configuredToken + ", Bearer " + configuredToken }
  ];

  await withServer({
    env: { NVIDIA_API_KEY: fakeKey, FLOW_COMPILER_ACCESS_TOKEN: configuredToken },
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("provider must not be called for unauthorized requests");
    }
  }, async baseUrl => {
    const responses = [];
    for (const item of cases) {
      const headers = { "Content-Type": "application/json" };
      if (item.authorization !== undefined) headers.Authorization = item.authorization;
      const response = await fetch(baseUrl + "/api/plan", {
        method: "POST",
        headers,
        body: JSON.stringify({ brainDump: "A valid request", availableMinutes: 15 })
      });
      const payload = await response.json();
      assert.equal(response.status, 401, item.name);
      assert.deepEqual(payload, {
        error: { code: "UNAUTHORIZED", message: "Valid authorization credentials are required." }
      }, item.name);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(JSON.stringify(payload).includes(configuredToken), false);
      assert.equal(JSON.stringify(payload).includes(fakeKey), false);
      responses.push(JSON.stringify(payload));
    }
    assert.equal(new Set(responses).size, 1, "credential failures must be indistinguishable");

    // Auth runs before JSON parsing: malformed unauthenticated bodies still
    // receive the same generic 401 and cannot reach validation/provider code.
    const malformedUnauthenticated = await fetch(baseUrl + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    assert.equal(malformedUnauthenticated.status, 401);
    assert.deepEqual(await malformedUnauthenticated.json(), {
      error: { code: "UNAUTHORIZED", message: "Valid authorization credentials are required." }
    });
  });

  assert.equal(providerCalls, 0);
});

test("unauthorized attempts still consume the API rate limit before authentication", async () => {
  let providerCalls = 0;
  await withServer({
    env: { FLOW_COMPILER_ACCESS_TOKEN: "f".repeat(43), NVIDIA_API_KEY: fakeKey },
    rateLimit: { windowMs: 60_000, limit: 1 },
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("provider must not be called");
    }
  }, async baseUrl => {
    const request = () => fetch(baseUrl + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brainDump: "A valid request", availableMinutes: 15 })
    });
    const first = await request();
    assert.equal(first.status, 401);
    assert.equal((await first.json()).error.code, "UNAUTHORIZED");
    const second = await request();
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, "RATE_LIMIT_EXCEEDED");
  });
  assert.equal(providerCalls, 0);
});

test("missing or malformed server token configuration fails closed without exposing configuration or calling provider", async () => {
  let providerCalls = 0;
  for (const configuredToken of ["", "short", "token with spaces"]) {
    await withServer({
      env: { NVIDIA_API_KEY: fakeKey, FLOW_COMPILER_ACCESS_TOKEN: configuredToken },
      fetchImpl: async () => {
        providerCalls += 1;
        throw new Error("provider must not be called without a valid server token");
      }
    }, async baseUrl => {
      const response = await fetch(baseUrl + "/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + "a".repeat(43) },
        body: JSON.stringify({ brainDump: "A valid request", availableMinutes: 15 })
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: { code: "AUTHENTICATION_NOT_CONFIGURED", message: "Plan API authentication is not configured." }
      });
    });
  }
  assert.equal(providerCalls, 0);
});

test("credential values are not written to console logs or HTTP responses", async () => {
  const configuredToken = "d".repeat(43);
  const submittedToken = "e".repeat(43);
  const observedLogs = [];
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  for (const method of Object.keys(originals)) {
    console[method] = (...args) => observedLogs.push(args.map(String).join(" "));
  }

  try {
    await withServer({
      env: { FLOW_COMPILER_ACCESS_TOKEN: configuredToken, NVIDIA_API_KEY: fakeKey },
      fetchImpl: async () => {
        throw new Error("provider must not be called");
      }
    }, async baseUrl => {
      const response = await fetch(baseUrl + "/api/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + submittedToken
        },
        body: JSON.stringify({ brainDump: "Test", availableMinutes: 15 })
      });
      const responseText = await response.text();
      assert.equal(response.status, 401);
      assert.equal(responseText.includes(configuredToken), false);
      assert.equal(responseText.includes(submittedToken), false);
      assert.equal(responseText.includes(fakeKey), false);
    });
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
  }

  assert.equal(observedLogs.some(line =>
    line.includes(configuredToken) || line.includes(submittedToken) || line.includes(fakeKey)
  ), false);
  assert.deepEqual(observedLogs, []);
});

test("public health remains available without an access token", async () => {
  await withServer({ env: { FLOW_COMPILER_ACCESS_TOKEN: "" } }, async baseUrl => {
    const response = await fetch(baseUrl + "/api/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "flow-compiler-api" });
  });
});

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
