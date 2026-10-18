import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNvidiaClient,
  DEFAULT_NVIDIA_MAX_RESPONSE_BYTES,
  DEFAULT_NVIDIA_TIMEOUT_MS,
  NVIDIA_API_ENDPOINT,
  NVIDIA_MODEL,
  NvidiaProviderError
} from "../src/nvidia-client.js";

const messages = [
  { role: "system", content: "Return JSON only." },
  { role: "user", content: "Plan a small task." }
];
const testSecret = "unit-test-secret-sentinel";

const validPlan = {
  summary: "Mock plan",
  totalMinutes: 15,
  tasks: [{
    id: "t1",
    title: "Complete a small task",
    minutes: 15,
    priority: "normal",
    reason: "It is the next concrete action.",
    dependsOn: [],
    category: "build"
  }]
};

function envelopeText(content = JSON.stringify(validPlan)) {
  return JSON.stringify({ model: NVIDIA_MODEL, choices: [{ message: { content } }] });
}

function responseFromBodyText(bodyText, {
  status = 200,
  contentLength,
  chunkSize = 64,
  onCancel,
  closeWhenDrained = true
} = {}) {
  const bytes = new TextEncoder().encode(bodyText);
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        if (closeWhenDrained) controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel(reason) {
      if (onCancel) onCancel(reason);
    }
  }, { highWaterMark: 0 });

  const headerValue = contentLength === undefined
    ? String(bytes.byteLength)
    : contentLength;

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length" ? headerValue : null;
      }
    },
    body: stream
  };
}

function clientFor(fetchImpl, options = {}) {
  return createNvidiaClient({
    env: { NVIDIA_API_KEY: testSecret, ...options.env },
    fetchImpl,
    timeoutMs: options.timeoutMs,
    maxResponseBytes: options.maxResponseBytes
  });
}

test("documents finite default timeout and conservative default response limit", () => {
  assert.equal(DEFAULT_NVIDIA_TIMEOUT_MS, 90_000);
  assert.equal(DEFAULT_NVIDIA_MAX_RESPONSE_BYTES, 1_048_576);
});

test("fails safely without a server-side NVIDIA_API_KEY and does not call fetch", async () => {
  let fetchCalled = false;
  const client = createNvidiaClient({
    env: { NVIDIA_API_KEY: "   " },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("Fetch should not run without configuration.");
    }
  });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.ok(error instanceof NvidiaProviderError);
    assert.equal(error.code, "AI_NOT_CONFIGURED");
    assert.equal(error.message, "NVIDIA provider is not configured.");
    assert.equal(error.message.includes("NVIDIA_API_KEY"), false);
    return true;
  });
  assert.equal(fetchCalled, false);
});

test("sends the source-plan endpoint/model and returns mocked message content", async () => {
  let requestUrl;
  let requestOptions;
  const client = clientFor(async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return responseFromBodyText(envelopeText());
  });

  const result = await client.createChatCompletion({ messages });
  assert.equal(requestUrl, NVIDIA_API_ENDPOINT);
  assert.equal(requestUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.Authorization, "Bearer " + testSecret);
  assert.equal(requestOptions.headers["Content-Type"], "application/json");
  assert.ok(requestOptions.signal instanceof AbortSignal);

  const sent = JSON.parse(requestOptions.body);
  assert.equal(sent.model, "nvidia/nemotron-3-ultra-550b-a55b");
  assert.equal(sent.stream, false);
  assert.equal(sent.temperature, 0.3);
  assert.equal(sent.max_tokens, 2500);
  assert.deepEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.deepEqual(sent.messages, messages);
  assert.equal(result.content, JSON.stringify(validPlan));
  assert.deepEqual(result.output, validPlan);
});

test("aborts a hung provider request and reports AI_TIMEOUT without transport details", async () => {
  let requestSignal;
  let observedAbort = false;
  const client = clientFor((_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal;
    requestSignal.addEventListener("abort", () => {
      observedAbort = true;
      reject(new Error("TLS failure for internal.provider.invalid with " + testSecret));
    }, { once: true });
  }), { timeoutMs: 15 });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_TIMEOUT");
    assert.equal(error.message, "The AI service request timed out.");
    assert.equal(error.message.includes(testSecret), false);
    assert.equal(error.message.includes("internal.provider.invalid"), false);
    return true;
  });
  assert.equal(observedAbort, true);
  assert.equal(requestSignal.aborted, true);
});

test("timeout covers a stalled response-body stream and cancels the reader", async () => {
  let cancelled = false;
  const stalledBody = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    }
  }, { highWaterMark: 0 });
  const response = {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: stalledBody
  };
  const client = clientFor(async () => response, { timeoutMs: 15 });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_TIMEOUT");
    return true;
  });
  assert.equal(cancelled, true);
});

test("clears the timeout after a successful response", async () => {
  let requestSignal;
  const client = clientFor(async (_url, options) => {
    requestSignal = options.signal;
    return responseFromBodyText(envelopeText());
  }, { timeoutMs: 15 });

  await client.createChatCompletion({ messages });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(requestSignal.aborted, false);
});

test("ordinary fetch/network failures remain distinct from timeout and expose no raw details", async () => {
  const client = clientFor(async () => {
    throw new Error("getaddrinfo failed at private.host.invalid with " + testSecret);
  });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_NETWORK_ERROR");
    assert.equal(error.message, "The AI service could not be reached.");
    assert.equal(error.message.includes(testSecret), false);
    assert.equal(error.message.includes("private.host.invalid"), false);
    assert.equal(error.message.includes("getaddrinfo"), false);
    return true;
  });
});

test("rejects oversized declared Content-Length early and cancels the body", async () => {
  let cancelled = false;
  const response = responseFromBodyText("sensitive upstream payload " + testSecret, {
    contentLength: "17",
    chunkSize: 2,
    closeWhenDrained: false,
    onCancel: () => { cancelled = true; }
  });
  const client = clientFor(async () => response, { maxResponseBytes: 16 });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_RESPONSE_TOO_LARGE");
    assert.equal(error.message, "The AI service returned a response that was too large.");
    assert.equal(error.message.includes(testSecret), false);
    assert.equal(error.message.includes("sensitive upstream payload"), false);
    return true;
  });
  assert.equal(cancelled, true);
});

test("enforces a streamed response limit when Content-Length is missing", async () => {
  let cancelled = false;
  const response = responseFromBodyText("x".repeat(40), {
    contentLength: null,
    chunkSize: 8,
    closeWhenDrained: false,
    onCancel: () => { cancelled = true; }
  });
  const client = clientFor(async () => response, { maxResponseBytes: 16 });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_RESPONSE_TOO_LARGE");
    return true;
  });
  assert.equal(cancelled, true);
});

test("enforces a streamed response limit when Content-Length is dishonest", async () => {
  let cancelled = false;
  const response = responseFromBodyText("z".repeat(40), {
    contentLength: "1",
    chunkSize: 8,
    closeWhenDrained: false,
    onCancel: () => { cancelled = true; }
  });
  const client = clientFor(async () => response, { maxResponseBytes: 16 });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_RESPONSE_TOO_LARGE");
    return true;
  });
  assert.equal(cancelled, true);
});

test("accepts a valid response exactly at the configured byte limit", async () => {
  const bodyText = envelopeText(JSON.stringify(validPlan));
  const byteLength = new TextEncoder().encode(bodyText).byteLength;
  const client = clientFor(async () => responseFromBodyText(bodyText, {
    contentLength: String(byteLength),
    chunkSize: 3
  }), { maxResponseBytes: byteLength });

  const result = await client.createChatCompletion({ messages });
  assert.deepEqual(result.output, validPlan);
});

test("ignores malformed Content-Length and still enforces the streamed limit", async () => {
  const bodyText = envelopeText(JSON.stringify(validPlan));
  const byteLength = new TextEncoder().encode(bodyText).byteLength;
  const client = clientFor(async () => responseFromBodyText(bodyText, {
    contentLength: "not-a-number",
    chunkSize: 2
  }), { maxResponseBytes: byteLength });

  const result = await client.createChatCompletion({ messages });
  assert.deepEqual(result.output, validPlan);

  const oversized = responseFromBodyText("x".repeat(32), {
    contentLength: "12, 12",
    chunkSize: 5,
    closeWhenDrained: false
  });
  const constrained = clientFor(async () => oversized, { maxResponseBytes: 16 });
  await assert.rejects(constrained.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_RESPONSE_TOO_LARGE");
    return true;
  });
});

test("maps NVIDIA's HTTP 202 pending response to a safe error without polling", async () => {
  let cancelled = false;
  let calls = 0;
  const response = responseFromBodyText(
    JSON.stringify({ requestId: "sensitive-pending-id", status: "pending", token: testSecret }),
    { status: 202, onCancel: () => { cancelled = true; }, closeWhenDrained: false }
  );
  const client = clientFor(async () => {
    calls += 1;
    return response;
  });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_PROVIDER_PENDING");
    assert.equal(error.message, "The AI service has not completed the request.");
    assert.equal(error.upstreamStatus, 202);
    assert.equal(error.message.includes(testSecret), false);
    assert.equal(error.message.includes("sensitive-pending-id"), false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test("maps HTTP provider statuses to stable safe errors and cancels error bodies", async () => {
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
    const response = responseFromBodyText(
      JSON.stringify({ error: "secret diagnostic at internal.provider.invalid " + testSecret }),
      {
        status,
        chunkSize: 5,
        closeWhenDrained: false,
        onCancel: () => { cancelled = true; }
      }
    );
    const client = clientFor(async () => response);

    await assert.rejects(client.createChatCompletion({ messages }), error => {
      assert.equal(error.code, expectedCode);
      assert.equal(error.upstreamStatus, status);
      assert.equal(error.message.includes(testSecret), false);
      assert.equal(error.message.includes("internal.provider.invalid"), false);
      assert.equal(error.message.includes("secret diagnostic"), false);
      return true;
    });
    assert.equal(cancelled, true);
  }
});

test("maps invalid upstream JSON and invalid UTF-8 to AI_INVALID_RESPONSE", async () => {
  const invalidJson = clientFor(async () => responseFromBodyText(
    "invalid provider JSON includes " + testSecret
  ));
  await assert.rejects(invalidJson.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_INVALID_RESPONSE");
    assert.equal(error.message, "The AI service returned an invalid response.");
    assert.equal(error.message.includes(testSecret), false);
    return true;
  });

  const badUtf8 = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff, 0xfe, 0xfd]));
      controller.close();
    }
  });
  const invalidUtf8 = clientFor(async () => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: badUtf8
  }));
  await assert.rejects(invalidUtf8.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_INVALID_RESPONSE");
    return true;
  });
});

test("rejects missing, non-string, and blank provider message content", async () => {
  const malformedPayloads = [
    {},
    { choices: [] },
    { choices: [{ message: {} }] },
    { choices: [{ message: { content: null } }] },
    { choices: [{ message: { content: 42 } }] },
    { choices: [{ message: { content: "" } }] },
    { choices: [{ message: { content: "   " } }] }
  ];

  for (const payload of malformedPayloads) {
    const client = clientFor(async () => responseFromBodyText(JSON.stringify(payload)));
    await assert.rejects(client.createChatCompletion({ messages }), error => {
      assert.equal(error.code, "AI_INVALID_RESPONSE");
      assert.equal(error.message, "The AI service returned an invalid response.");
      assert.equal(error.message.includes(testSecret), false);
      return true;
    });
  }
});


test("maps invalid model JSON to INVALID_MODEL_OUTPUT without exposing model content", async () => {
  const secretModelText = "prefix diagnostic " + testSecret + " " + JSON.stringify({ summary: "would-be fragment" });
  const client = clientFor(async () => responseFromBodyText(envelopeText(secretModelText)));

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(testSecret), false);
    assert.equal(error.message.includes("prefix diagnostic"), false);
    assert.equal(error.message.includes("would-be fragment"), false);
    return true;
  });
});

test("rejects syntactically valid schema-invalid plans without exposing model output", async () => {
  const privateModelText = JSON.stringify({
    summary: "private-model-note",
    totalMinutes: 1,
    tasks: [],
    credentialSentinel: testSecret
  });
  const client = clientFor(async () => responseFromBodyText(envelopeText(privateModelText)));
  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(testSecret), false);
    assert.equal(error.message.includes("private-model-note"), false);
    assert.equal(error.message.includes("credentialSentinel"), false);
    return true;
  });
});

test("uses NVIDIA_TIMEOUT_MS from server environment configuration", async () => {
  let observedAbort = false;
  const client = createNvidiaClient({
    env: {
      NVIDIA_API_KEY: testSecret,
      NVIDIA_TIMEOUT_MS: "15"
    },
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(new Error("internal test transport error"));
      }, { once: true });
    })
  });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_TIMEOUT");
    assert.equal(error.message, "The AI service request timed out.");
    assert.equal(error.message.includes(testSecret), false);
    return true;
  });
  assert.equal(observedAbort, true);
});

test("reads NVIDIA_MAX_RESPONSE_BYTES from server environment configuration", async () => {
  const bodyText = envelopeText("small");
  const client = createNvidiaClient({
    env: {
      NVIDIA_API_KEY: testSecret,
      NVIDIA_TIMEOUT_MS: "12000",
      NVIDIA_MAX_RESPONSE_BYTES: "12"
    },
    fetchImpl: async () => responseFromBodyText(bodyText, {
      contentLength: null,
      chunkSize: 5,
      closeWhenDrained: false
    })
  });

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "AI_RESPONSE_TOO_LARGE");
    assert.equal(error.message.includes(testSecret), false);
    return true;
  });
});


test("rejects model output with dependency graph violations after schema validation", async () => {
  const invalidPlan = structuredClone(validPlan);
  invalidPlan.summary = "safe-summary-sentinel";
  invalidPlan.tasks[0].dependsOn = ["unknown-dependency"];
  const client = clientFor(async () => responseFromBodyText(envelopeText(JSON.stringify(invalidPlan))));

  await assert.rejects(client.createChatCompletion({ messages }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes("safe-summary-sentinel"), false);
    assert.equal(error.message.includes("unknown-dependency"), false);
    assert.equal(error.message.includes(testSecret), false);
    return true;
  });
});

test("accepts a completed prerequisite only when supplied explicitly as context", async () => {
  const revisedPlan = structuredClone(validPlan);
  revisedPlan.tasks[0].dependsOn = ["done1"];
  const client = clientFor(async () => responseFromBodyText(envelopeText(JSON.stringify(revisedPlan))));

  const result = await client.createChatCompletion({ messages, completedTaskIds: ["done1"] });
  assert.deepEqual(result.output, revisedPlan);
});

test("rejects generated task IDs colliding with explicit completed-task context", async () => {
  const client = clientFor(async () => responseFromBodyText(envelopeText()));

  await assert.rejects(client.createChatCompletion({ messages, completedTaskIds: ["t1"] }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(testSecret), false);
    return true;
  });
});


test("requires explicit available-minute context and enforces schedule fit after dependency validation", async () => {
  const overBudget = structuredClone(validPlan);
  overBudget.tasks[0].minutes = 16;
  overBudget.totalMinutes = 16;
  const client = clientFor(async () => responseFromBodyText(envelopeText(JSON.stringify(overBudget))));

  await assert.rejects(client.createChatCompletion({ messages, availableMinutes: 15 }), error => {
    assert.equal(error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(error.message, "The model returned an invalid plan.");
    assert.equal(error.message.includes(testSecret), false);
    return true;
  });
});

test("passes availableMinutes and validated revision context as explicit adapter inputs", async () => {
  const client = clientFor(async (_url, options) => {
    const sent = JSON.parse(options.body);
    assert.equal(sent.messages.some(message => message.content.includes("Available time: 15 minutes.")), true);
    return responseFromBodyText(envelopeText());
  });
  const result = await client.createChatCompletion({
    messages: [{ role: "user", content: "Available time: 15 minutes." }],
    availableMinutes: 15,
    completedTaskIds: [],
    revisionContext: { reason: "time_changed" }
  });
  assert.deepEqual(result.output, validPlan);
});
