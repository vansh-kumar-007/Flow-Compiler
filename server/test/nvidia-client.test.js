import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNvidiaClient,
  NVIDIA_API_ENDPOINT,
  NVIDIA_MODEL,
  NvidiaProviderError
} from "../src/nvidia-client.js";

const messages = [
  { role: "system", content: "Return JSON only." },
  { role: "user", content: "Plan a small task." }
];

function successfulResponse(content = "{\"summary\":\"mock plan\"}") {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        model: NVIDIA_MODEL,
        choices: [{ message: { content } }]
      };
    }
  };
}

test("fails safely without a server-side NVIDIA_API_KEY and does not call fetch", async () => {
  let fetchCalled = false;
  const client = createNvidiaClient({
    env: { NVIDIA_API_KEY: "   " },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("Fetch should not run without configuration.");
    }
  });

  await assert.rejects(
    client.createChatCompletion({ messages }),
    error => {
      assert.ok(error instanceof NvidiaProviderError);
      assert.equal(error.code, "AI_NOT_CONFIGURED");
      assert.equal(error.message, "NVIDIA provider is not configured.");
      assert.equal(error.message.includes("NVIDIA_API_KEY"), false);
      return true;
    }
  );
  assert.equal(fetchCalled, false);
});

test("sends the source-plan endpoint/model and returns mocked message content", async () => {
  const testOnlyKey = "test-only-not-a-real-credential";
  let requestUrl;
  let requestOptions;
  const client = createNvidiaClient({
    env: { NVIDIA_API_KEY: testOnlyKey },
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return successfulResponse();
    }
  });

  const result = await client.createChatCompletion({ messages });

  assert.equal(requestUrl, NVIDIA_API_ENDPOINT);
  assert.equal(requestUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.Authorization, "Bearer " + testOnlyKey);
  assert.equal(requestOptions.headers["Content-Type"], "application/json");

  const sent = JSON.parse(requestOptions.body);
  assert.equal(sent.model, "nvidia/nemotron-3-ultra-550b-a55b");
  assert.equal(sent.stream, false);
  assert.equal(sent.temperature, 0.3);
  assert.equal(sent.max_tokens, 2500);
  assert.deepEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.deepEqual(sent.messages, messages);
  assert.deepEqual(result, { content: "{\"summary\":\"mock plan\"}" });
});

test("maps provider HTTP errors to a safe error without reading upstream details", async () => {
  const sensitiveUpstreamText = "provider diagnostic accidentally echoed test-only-not-a-real-credential";
  let bodyRead = false;
  const client = createNvidiaClient({
    env: { NVIDIA_API_KEY: "test-only-not-a-real-credential" },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        bodyRead = true;
        return sensitiveUpstreamText;
      },
      async json() {
        bodyRead = true;
        return { error: sensitiveUpstreamText };
      }
    })
  });

  await assert.rejects(
    client.createChatCompletion({ messages }),
    error => {
      assert.equal(error.code, "AI_PROVIDER_ERROR");
      assert.equal(error.upstreamStatus, 401);
      assert.equal(error.message, "The AI service could not complete the request.");
      assert.equal(error.message.includes("test-only-not-a-real-credential"), false);
      assert.equal(error.message.includes("provider diagnostic"), false);
      return true;
    }
  );
  assert.equal(bodyRead, false);
});

test("wraps transport failures without leaking transport text or credentials", async () => {
  const sensitive = "socket error Authorization: Bearer test-only-not-a-real-credential";
  const client = createNvidiaClient({
    env: { NVIDIA_API_KEY: "test-only-not-a-real-credential" },
    fetchImpl: async () => {
      throw new Error(sensitive);
    }
  });

  await assert.rejects(
    client.createChatCompletion({ messages }),
    error => {
      assert.equal(error.code, "AI_PROVIDER_ERROR");
      assert.equal(error.message, "The AI service could not complete the request.");
      assert.equal(error.message.includes("test-only-not-a-real-credential"), false);
      assert.equal(error.message.includes("socket error"), false);
      return true;
    }
  );
});

test("maps invalid provider JSON to a safe error", async () => {
  const client = createNvidiaClient({
    env: { NVIDIA_API_KEY: "test-only-not-a-real-credential" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new Error("raw provider body includes test-only-not-a-real-credential");
      }
    })
  });

  await assert.rejects(
    client.createChatCompletion({ messages }),
    error => {
      assert.equal(error.code, "AI_PROVIDER_ERROR");
      assert.equal(error.message, "The AI service returned an invalid response.");
      assert.equal(error.message.includes("test-only-not-a-real-credential"), false);
      return true;
    }
  );
});

test("rejects successful HTTP responses without a non-empty message content safely", async () => {
  const malformedPayloads = [
    {},
    { choices: [] },
    { choices: [{ message: {} }] },
    { choices: [{ message: { content: "   " } }] }
  ];

  for (const payload of malformedPayloads) {
    const client = createNvidiaClient({
      env: { NVIDIA_API_KEY: "test-only-not-a-real-credential" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() { return payload; }
      })
    });

    await assert.rejects(
      client.createChatCompletion({ messages }),
      error => {
        assert.equal(error.code, "AI_PROVIDER_ERROR");
        assert.equal(error.message, "The AI service returned an invalid response.");
        return true;
      }
    );
  }
});
