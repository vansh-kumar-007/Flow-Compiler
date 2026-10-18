import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanningApiError, requestPlan } from "./plan-api.js";

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      if (payload instanceof Error) throw payload;
      return payload;
    }
  };
}
function plan() {
  return {
    summary: "Resolve the blocker.",
    totalMinutes: 15,
    tasks: [
      { id: "t1", title: "Reproduce the failure", minutes: 15, priority: "high", reason: "Find the cause.", dependsOn: [], category: "build" }
    ]
  };
}
function args(overrides = {}) {
  return {
    fetchImpl: async () => response(plan()),
    url: "https://api.example.test/api/plan",
    token: "fake-test-token",
    brainDump: " Fix the blocker ",
    availableMinutes: 30,
    signal: new AbortController().signal,
    ...overrides
  };
}

test("sends the documented request shape and bearer token only in Authorization", async () => {
  let seenUrl;
  let seenOptions;
  const payload = plan();
  const result = await requestPlan(args({
    fetchImpl: async (url, options) => {
      seenUrl = url;
      seenOptions = options;
      return response(payload);
    }
  }));
  assert.equal(seenUrl, "https://api.example.test/api/plan");
  assert.equal(seenOptions.method, "POST");
  assert.equal(seenOptions.headers.Authorization, "Bearer fake-test-token");
  assert.equal(seenOptions.headers.Accept, "application/json");
  assert.deepEqual(JSON.parse(seenOptions.body), {
    brainDump: "Fix the blocker",
    availableMinutes: 30,
    previousPlan: null
  });
  assert.ok(!seenOptions.body.includes("fake-test-token"));
  assert.equal(result, payload);
});

test("does not call fetch if the token is absent or whitespace-only", async () => {
  let calls = 0;
  for (const token of ["", " \n ", null]) {
    await assert.rejects(requestPlan(args({
      token,
      fetchImpl: async () => { calls += 1; return response(plan()); }
    })), error => error instanceof PlanningApiError && error.code === "MISSING_ACCESS_TOKEN");
  }
  assert.equal(calls, 0);
});

test("handles invalid credentials without exposing response details", async () => {
  await assert.rejects(requestPlan(args({
    fetchImpl: async () => response({ error: { code: "UNAUTHORIZED", message: "secret detail should not be reflected" } }, { ok: false, status: 401 })
  })), error => error.code === "UNAUTHORIZED" && /Access token rejected/.test(error.message) && !error.message.includes("secret detail"));
});

test("handles the safe missing-provider-key result without treating it as a plan", async () => {
  await assert.rejects(requestPlan(args({
    fetchImpl: async () => response({ error: { code: "AI_NOT_CONFIGURED", message: "private upstream detail" } }, { ok: false, status: 500 })
  })), error => error.code === "AI_NOT_CONFIGURED" && /No plan was generated/.test(error.message) && !error.message.includes("private"));
});

test("maps upstream provider authentication errors without exposing provider details", async () => {
  await assert.rejects(requestPlan(args({
    fetchImpl: async () => response({
      error: { code: "AI_AUTHENTICATION_ERROR", message: "private upstream diagnostic" }
    }, { ok: false, status: 502 })
  })), error =>
    error.code === "AI_AUTHENTICATION_ERROR"
    && /server-side credentials/.test(error.message)
    && /No plan was generated/.test(error.message)
    && !error.message.includes("private upstream diagnostic"));
});

test("handles rate-limit and timeout codes with stable guidance", async () => {
  await assert.rejects(requestPlan(args({
    fetchImpl: async () => response({ error: { code: "RATE_LIMIT_EXCEEDED", message: "internal" } }, { ok: false, status: 429 })
  })), error => error.code === "RATE_LIMIT_EXCEEDED" && /Wait/.test(error.message));
  await assert.rejects(requestPlan(args({
    fetchImpl: async () => response({ error: { code: "AI_TIMEOUT", message: "internal" } }, { ok: false, status: 504 })
  })), error => error.code === "AI_TIMEOUT" && /timed out/.test(error.message));
});

test("handles network rejection, malformed JSON and invalid successful responses", async () => {
  await assert.rejects(requestPlan(args({ fetchImpl: async () => { throw new Error("credentials and transport detail"); } })),
    error => error.code === "NETWORK_ERROR" && /Could not reach/.test(error.message) && !error.message.includes("credentials"));
  await assert.rejects(requestPlan(args({ fetchImpl: async () => response(new Error("invalid JSON")) })),
    error => error.code === "INVALID_PLAN_RESPONSE" && /did not match/.test(error.message));
  await assert.rejects(requestPlan(args({ fetchImpl: async () => response({ ...plan(), tasks: [] }) })),
    error => error.code === "INVALID_PLAN_RESPONSE");
});

test("aborted request never exposes low-level fetch details", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestPlan(args({
    signal: controller.signal,
    fetchImpl: async () => { throw new Error("low-level details"); }
  })), error => error.code === "REQUEST_CANCELLED" && !error.message.includes("low-level"));
});

test("passes the supplied AbortSignal to fetch and classifies an aborted fetch as cancellation", async () => {
  const controller = new AbortController();
  let seenSignal;
  const pending = requestPlan(args({
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      seenSignal = options.signal;
      controller.abort();
      throw new Error("low-level abort detail");
    }
  }));
  await assert.rejects(pending, error => error.code === "REQUEST_CANCELLED" && !error.message.includes("low-level"));
  assert.equal(seenSignal, controller.signal);
});

test("rejects malformed API URLs before invoking fetch", async () => {
  let calls = 0;
  for (const url of ["", "https://api.example.test/other", null]) {
    await assert.rejects(requestPlan(args({ url, fetchImpl: async () => { calls += 1; return response(plan()); } })),
      error => error.code === "INVALID_API_URL");
  }
  assert.equal(calls, 0);
});
