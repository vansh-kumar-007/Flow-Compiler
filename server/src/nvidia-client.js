import { parseModelOutput } from "./model-output.js";
import { validateGeneratedPlan } from "./plan-output.js";
import { validateGeneratedDependencies } from "./dependency-graph.js";
import { validateGeneratedSchedule } from "./schedule-output.js";

export const NVIDIA_API_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

export const DEFAULT_NVIDIA_TIMEOUT_MS = 90_000;
export const DEFAULT_NVIDIA_MAX_RESPONSE_BYTES = 1_048_576;

const MAX_NVIDIA_TIMEOUT_MS = 120_000;
const MAX_NVIDIA_RESPONSE_BYTES = 10_485_760;

const MESSAGES = Object.freeze({
  AI_NOT_CONFIGURED: "NVIDIA provider is not configured.",
  AI_TIMEOUT: "The AI service request timed out.",
  AI_NETWORK_ERROR: "The AI service could not be reached.",
  AI_AUTHENTICATION_ERROR: "The AI service rejected its server credentials.",
  AI_ACCESS_DENIED: "The AI service denied access to the requested resource.",
  AI_RATE_LIMITED: "The AI service is rate-limited. Please try again later.",
  AI_PROVIDER_UNAVAILABLE: "The AI service is temporarily unavailable.",
  AI_PROVIDER_PENDING: "The AI service has not completed the request.",
  AI_PROVIDER_ERROR: "The AI service could not complete the request.",
  AI_RESPONSE_TOO_LARGE: "The AI service returned a response that was too large.",
  AI_INVALID_RESPONSE: "The AI service returned an invalid response.",
  INVALID_MODEL_OUTPUT: "The model returned an invalid plan."
});

export class NvidiaProviderError extends Error {
  constructor(code, message = MESSAGES[code], upstreamStatus) {
    super(message);
    this.name = "NvidiaProviderError";
    this.code = code;
    // Numeric metadata only. Never retain the provider response body or transport error.
    if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) {
      this.upstreamStatus = upstreamStatus;
    }
  }
}

function resolveBoundedInteger(override, environmentValue, fallback, maximum) {
  const candidate = override === undefined ? environmentValue : override;
  let value = candidate;

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return fallback;
    value = Number(normalized);
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) return fallback;
  return value;
}

function createError(code, status) {
  return new NvidiaProviderError(code, MESSAGES[code], status);
}

function mapHttpFailure(status) {
  if (status === 401) return createError("AI_AUTHENTICATION_ERROR", status);
  if (status === 403) return createError("AI_ACCESS_DENIED", status);
  if (status === 429) return createError("AI_RATE_LIMITED", status);
  if (Number.isInteger(status) && status >= 500 && status <= 599) {
    return createError("AI_PROVIDER_UNAVAILABLE", status);
  }
  return createError("AI_PROVIDER_ERROR", status);
}

function declaredContentLength(response) {
  let header;
  try {
    header = response?.headers?.get?.("content-length");
  } catch {
    return null;
  }

  if (typeof header !== "string") return null;
  const normalized = header.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const length = Number(normalized);
  return Number.isSafeInteger(length) ? length : null;
}

function cancelResponseBody(response) {
  try {
    const cancellation = response?.body?.cancel?.();
    if (cancellation && typeof cancellation.catch === "function") {
      void cancellation.catch(() => {});
    }
  } catch {
    // Cancellation is best-effort; the original safe provider error is authoritative.
  }
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === "function") {
      void cancellation.catch(() => {});
    }
  } catch {
    // The stream may already be closed or errored.
  }
}

/**
 * Reads a standard Fetch response body incrementally. The total bytes retained
 * in memory never exceed maxBytes; Content-Length is only an early-rejection hint.
 */
async function readBoundedBody(response, maxBytes, signal) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    throw createError("AI_INVALID_RESPONSE", response?.status);
  }

  let reader;
  try {
    reader = body.getReader();
  } catch {
    throw createError("AI_INVALID_RESPONSE", response?.status);
  }

  const onAbort = () => cancelReader(reader);
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;

      const chunk = item.value;
      if (!(chunk instanceof Uint8Array)) {
        throw createError("AI_INVALID_RESPONSE", response?.status);
      }

      if (chunk.byteLength > maxBytes - totalBytes) {
        cancelReader(reader);
        throw createError("AI_RESPONSE_TOO_LARGE", response?.status);
      }

      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // A read error can leave the implementation unable to release its lock.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Builds an injectable NVIDIA Chat Completions client.
 *
 * By default the credential and provider limit settings come from the server
 * process environment. Tests may inject an environment object and fetch
 * implementation. No network request is made until createChatCompletion runs.
 */
export function createNvidiaClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs: timeoutOverride,
  maxResponseBytes: responseLimitOverride
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }

  const timeoutMs = resolveBoundedInteger(
    timeoutOverride,
    env.NVIDIA_TIMEOUT_MS,
    DEFAULT_NVIDIA_TIMEOUT_MS,
    MAX_NVIDIA_TIMEOUT_MS
  );
  const maxResponseBytes = resolveBoundedInteger(
    responseLimitOverride,
    env.NVIDIA_MAX_RESPONSE_BYTES,
    DEFAULT_NVIDIA_MAX_RESPONSE_BYTES,
    MAX_NVIDIA_RESPONSE_BYTES
  );

  return Object.freeze({
    async createChatCompletion({
      messages,
      temperature = 0.3,
      maxTokens = 2500,
      chatTemplateKwargs = { enable_thinking: false },
      // This must come from validated previousPlan.completedTaskIds request context,
      // never from model-generated prose.
      completedTaskIds = [],
      availableMinutes,
      revisionContext = null
    } = {}) {
      const apiKey = typeof env.NVIDIA_API_KEY === "string"
        ? env.NVIDIA_API_KEY.trim()
        : "";

      if (!apiKey) {
        throw createError("AI_NOT_CONFIGURED");
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new TypeError("messages must be a non-empty array.");
      }

      const controller = new AbortController();
      let activeResponse;
      let didTimeout = false;
      const timeoutError = createError("AI_TIMEOUT");
      let rejectTimeout;
      const timeoutPromise = new Promise((_resolve, reject) => {
        rejectTimeout = reject;
      });

      const timeoutHandle = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        cancelResponseBody(activeResponse);
        rejectTimeout(timeoutError);
      }, timeoutMs);

      const performRequest = async () => {
        let response;
        try {
          response = await fetchImpl(NVIDIA_API_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: "Bearer " + apiKey,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              model: NVIDIA_MODEL,
              messages,
              temperature,
              max_tokens: maxTokens,
              stream: false,
              chat_template_kwargs: chatTemplateKwargs
            }),
            signal: controller.signal
          });
        } catch {
          if (didTimeout) throw timeoutError;
          throw createError("AI_NETWORK_ERROR");
        }

        activeResponse = response;
        if (!response || typeof response.ok !== "boolean"
            || !Number.isInteger(response.status)) {
          throw createError("AI_INVALID_RESPONSE");
        }

        // NVIDIA documents HTTP 202 as an asynchronous request still pending.
        // This client deliberately does not poll a second endpoint: return a safe,
        // explicit failure rather than misclassifying the pending envelope as a plan.
        if (response.status === 202) {
          cancelResponseBody(response);
          throw createError("AI_PROVIDER_PENDING", response.status);
        }

        if (!response.ok) {
          // Never consume upstream error bodies or copy their diagnostics into errors.
          cancelResponseBody(response);
          throw mapHttpFailure(response.status);
        }

        const contentLength = declaredContentLength(response);
        if (contentLength !== null && contentLength > maxResponseBytes) {
          cancelResponseBody(response);
          throw createError("AI_RESPONSE_TOO_LARGE", response.status);
        }

        let bytes;
        try {
          bytes = await readBoundedBody(response, maxResponseBytes, controller.signal);
        } catch (error) {
          if (error instanceof NvidiaProviderError) throw error;
          if (didTimeout) throw timeoutError;
          throw createError("AI_NETWORK_ERROR", response.status);
        }

        let bodyText;
        try {
          bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw createError("AI_INVALID_RESPONSE", response.status);
        }

        let payload;
        try {
          payload = JSON.parse(bodyText);
        } catch {
          throw createError("AI_INVALID_RESPONSE", response.status);
        }

        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          throw createError("AI_INVALID_RESPONSE", response.status);
        }

        let output;
        try {
          output = parseModelOutput(content);
        } catch {
          // Model content is distinct from the upstream API envelope; never echo it.
          throw createError("INVALID_MODEL_OUTPUT", response.status);
        }

        // Keep P2-05 parsing, P2-06 schema validation, P2-07 graph validation,
        // and P2-08 time-budget validation as independent ordered stages.
        if (validateGeneratedPlan(output)) {
          throw createError("INVALID_MODEL_OUTPUT", response.status);
        }
        if (validateGeneratedDependencies(output, { completedTaskIds })) {
          throw createError("INVALID_MODEL_OUTPUT", response.status);
        }
        if (availableMinutes !== undefined
            && validateGeneratedSchedule(output, { availableMinutes, revisionContext })) {
          throw createError("INVALID_MODEL_OUTPUT", response.status);
        }

        return { content, output };
      };

      try {
        return await Promise.race([performRequest(), timeoutPromise]);
      } catch (error) {
        if (didTimeout) throw timeoutError;
        if (error instanceof NvidiaProviderError) throw error;
        // Catch unanticipated fetch/stream failures without forwarding the raw exception.
        throw createError("AI_NETWORK_ERROR");
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  });
}
