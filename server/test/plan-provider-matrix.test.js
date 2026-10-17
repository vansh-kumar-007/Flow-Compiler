import assert from "node:assert/strict";
import { test } from "node:test";
import { createNvidiaClient, NvidiaProviderError, NVIDIA_MODEL } from "../src/nvidia-client.js";

const fakeKey = "p2-10-fake-key-do-not-use";
const privateSentinel = "private-upstream-and-model-sentinel";
const messages = [
  { role: "system", content: "Return only a valid plan JSON value." },
  { role: "user", content: "Plan a small, safe task within 15 minutes." }
];

const goodPlan = {
  summary: "Complete the next concrete action.",
  totalMinutes: 15,
  tasks: [{
    id: "t1",
    title: "Complete the small task",
    minutes: 15,
    priority: "normal",
    reason: "It is the next executable action.",
    dependsOn: [],
    category: "build"
  }]
};

function responseBody(content = JSON.stringify(goodPlan)) {
  return JSON.stringify({ model: NVIDIA_MODEL, choices: [{ message: { content } }] });
}

function responseFromText(text, { status = 200, contentLength, chunkSize = 32, onCancel } = {}) {
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
  const headerValue = contentLength === undefined ? String(bytes.byteLength) : contentLength;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === "content-length" ? headerValue : null; } },
    body
  };
}

function clientFor(fetchImpl, env = { NVIDIA_API_KEY: fakeKey }, options = {}) {
  return createNvidiaClient({
    env,
    fetchImpl,
    timeoutMs: options.timeoutMs ?? 1_000,
    maxResponseBytes: options.maxResponseBytes ?? 64 * 1024
  });
}

test("P2-10 mocked provider pipeline accepts one complete valid plan through every validation stage", async () => {
  let calls = 0;
  const client = clientFor(async (url, options) => {
    calls += 1;
    assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer " + fakeKey);
    assert.equal(options.headers["Content-Type"], "application/json");
    const request = JSON.parse(options.body);
    assert.equal(request.stream, false);
    assert.deepEqual(request.messages, messages);
    return responseFromText(responseBody(), { chunkSize: 7 });
  });

  const result = await client.createChatCompletion({
    messages,
    availableMinutes: 15,
    completedTaskIds: [],
    revisionContext: null
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.output, goodPlan);
  assert.equal(result.content, JSON.stringify(goodPlan));
});

test("P2-10 mocked provider pipeline fails closed without credentials and makes no provider call", async () => {
  let calls = 0;
  const client = clientFor(async () => {
    calls += 1;
    throw new Error("fetch must not be called");
  }, { NVIDIA_API_KEY: "   " });

  await assert.rejects(client.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.ok(error instanceof NvidiaProviderError);
    assert.equal(error.code, "AI_NOT_CONFIGURED");
    assert.equal(error.message, "NVIDIA provider is not configured.");
    assert.equal(error.message.includes("NVIDIA_API_KEY"), false);
    assert.equal(error.message.includes(fakeKey), false);
    return true;
  });
  assert.equal(calls, 0);
});

test("P2-10 mocked HTTP failures preserve distinct provider mappings and discard diagnostic bodies", async () => {
  const cases = [
    [401, "AI_AUTHENTICATION_ERROR"],
    [403, "AI_ACCESS_DENIED"],
    [429, "AI_RATE_LIMITED"],
    [500, "AI_PROVIDER_UNAVAILABLE"],
    [503, "AI_PROVIDER_UNAVAILABLE"],
    [418, "AI_PROVIDER_ERROR"]
  ];
  for (const [status, expectedCode] of cases) {
    let cancelled = false;
    const client = clientFor(async () => responseFromText(
      JSON.stringify({ diagnostic: privateSentinel, key: fakeKey }),
      { status, onCancel: () => { cancelled = true; } }
    ));
    await assert.rejects(client.createChatCompletion({ messages, availableMinutes: 15 }), error => {
      assert.ok(error instanceof NvidiaProviderError);
      assert.equal(error.code, expectedCode);
      assert.equal(error.upstreamStatus, status);
      assert.equal(error.message.includes(privateSentinel), false);
      assert.equal(error.message.includes(fakeKey), false);
      return true;
    });
    assert.equal(cancelled, true);
  }
});

test("P2-10 mocked provider transport failure has a stable safe network error", async () => {
  const client = clientFor(async () => {
    throw new Error("private.provider.invalid " + privateSentinel + " " + fakeKey);
  });
  await assert.rejects(client.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "AI_NETWORK_ERROR");
    assert.equal(error.message, "The AI service could not be reached.");
    assert.equal(error.message.includes("private.provider.invalid"), false);
    assert.equal(error.message.includes(privateSentinel), false);
    assert.equal(error.message.includes(fakeKey), false);
    return true;
  });
});

test("P2-10 mocked pipeline rejects malformed provider envelope and malformed model JSON separately", async () => {
  const invalidEnvelope = clientFor(async () => responseFromText("{\"choices\":["));
  await assert.rejects(invalidEnvelope.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "AI_INVALID_RESPONSE");
    assert.equal(error.message, "The AI service returned an invalid response.");
    return true;
  });

  const invalidModelContent = clientFor(async () => responseFromText(responseBody(
    "preamble " + privateSentinel + " " + JSON.stringify(goodPlan)
  )));
  await assert.rejects(invalidModelContent.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(privateSentinel), false);
    assert.equal(error.message.includes("preamble"), false);
    return true;
  });
});

test("P2-10 mocked pipeline rejects schema-invalid output without disclosing model content", async () => {
  const invalid = structuredClone(goodPlan);
  invalid.privateDiagnostic = privateSentinel;
  const client = clientFor(async () => responseFromText(responseBody(JSON.stringify(invalid))));
  await assert.rejects(client.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(privateSentinel), false);
    assert.equal(error.message.includes("privateDiagnostic"), false);
    return true;
  });
});

test("P2-10 mocked pipeline runs dependency graph validation after schema validation", async () => {
  const dangling = structuredClone(goodPlan);
  dangling.tasks[0].dependsOn = ["missing"];
  const unknownClient = clientFor(async () => responseFromText(responseBody(JSON.stringify(dangling))));
  await assert.rejects(unknownClient.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message.includes("missing"), false);
    return true;
  });

  const cyclic = {
    summary: "A valid schema containing a graph cycle.",
    totalMinutes: 2,
    tasks: [
      { ...goodPlan.tasks[0], id: "t1", minutes: 1, dependsOn: ["t2"] },
      { ...goodPlan.tasks[0], id: "t2", minutes: 1, dependsOn: ["t1"] }
    ]
  };
  const cycleClient = clientFor(async () => responseFromText(responseBody(JSON.stringify(cyclic))));
  await assert.rejects(cycleClient.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes("t1"), false);
    return true;
  });
});

test("P2-10 mocked pipeline enforces budget and deferred-work contracts", async () => {
  const overBudget = structuredClone(goodPlan);
  overBudget.tasks[0].minutes = 16;
  overBudget.totalMinutes = 16;
  const budgetClient = clientFor(async () => responseFromText(responseBody(JSON.stringify(overBudget))));
  await assert.rejects(budgetClient.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    return true;
  });

  const validDeferred = {
    summary: "Keep scheduled work small, defer the rest.",
    totalMinutes: 10,
    tasks: [{ ...goodPlan.tasks[0], id: "t1", minutes: 10 }],
    deferredTasks: [{
      ...goodPlan.tasks[0],
      id: "t2",
      minutes: 45,
      deferredReason: "Not enough time remains in this execution window."
    }]
  };
  const deferredClient = clientFor(async () => responseFromText(responseBody(JSON.stringify(validDeferred))));
  const result = await deferredClient.createChatCompletion({ messages, availableMinutes: 15 });
  assert.deepEqual(result.output, validDeferred);

  const invalidDeferred = structuredClone(validDeferred);
  invalidDeferred.deferredTasks[0].deferredReason = "   ";
  const invalidDeferredClient = clientFor(async () => responseFromText(responseBody(JSON.stringify(invalidDeferred))));
  await assert.rejects(invalidDeferredClient.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    return true;
  });
});

test("P2-10 remains test-only: the public HTTP route validates requests but still returns 501", async () => {
  // Deliberately do not wire createNvidiaClient into createApp in P2-10.
  // The isolated provider pipeline above uses only injected local fake responses.
  const { createApp } = await import("../src/app.js");
  const server = createApp({
    allowedOrigins: ["http://localhost:5173"],
    rateLimit: { windowMs: 60_000, limit: 100 }
  }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const url = "http://127.0.0.1:" + server.address().port;
    const invalid = await fetch(url + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brainDump: "", availableMinutes: 15 })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_REQUEST");

    const valid = await fetch(url + "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brainDump: "complete one task", availableMinutes: 15, previousPlan: null })
    });
    assert.equal(valid.status, 501);
    assert.deepEqual(await valid.json(), {
      error: {
        code: "PLANNING_NOT_IMPLEMENTED",
        message: "AI planning is not available yet."
      }
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
