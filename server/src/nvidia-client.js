export const NVIDIA_API_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

const MISSING_CONFIGURATION_MESSAGE = "NVIDIA provider is not configured.";
const PROVIDER_FAILURE_MESSAGE = "The AI service could not complete the request.";
const INVALID_RESPONSE_MESSAGE = "The AI service returned an invalid response.";

export class NvidiaProviderError extends Error {
  constructor(code, message, upstreamStatus) {
    super(message);
    this.name = "NvidiaProviderError";
    this.code = code;
    // Numeric metadata only. Never retain or expose the provider response body.
    if (Number.isInteger(upstreamStatus)) this.upstreamStatus = upstreamStatus;
  }
}

/**
 * Builds an injectable NVIDIA Chat Completions client.
 *
 * The default credential source is the server process environment. Callers/tests
 * may inject an environment object and fetch implementation; no credential or
 * network dependency is captured at module import time.
 */
export function createNvidiaClient({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }

  return Object.freeze({
    async createChatCompletion({
      messages,
      temperature = 0.3,
      maxTokens = 2500,
      chatTemplateKwargs = { enable_thinking: false }
    } = {}) {
      const apiKey = typeof env.NVIDIA_API_KEY === "string"
        ? env.NVIDIA_API_KEY.trim()
        : "";

      if (!apiKey) {
        throw new NvidiaProviderError(
          "AI_NOT_CONFIGURED",
          MISSING_CONFIGURATION_MESSAGE
        );
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        throw new TypeError("messages must be a non-empty array.");
      }

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
          })
        });
      } catch {
        // Do not propagate the transport error: it can include request metadata.
        throw new NvidiaProviderError(
          "AI_PROVIDER_ERROR",
          PROVIDER_FAILURE_MESSAGE
        );
      }

      if (!response || typeof response.ok !== "boolean") {
        throw new NvidiaProviderError(
          "AI_PROVIDER_ERROR",
          PROVIDER_FAILURE_MESSAGE
        );
      }

      if (!response.ok) {
        // Intentionally do not read or log upstream error bodies in this adapter.
        throw new NvidiaProviderError(
          "AI_PROVIDER_ERROR",
          PROVIDER_FAILURE_MESSAGE,
          response.status
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new NvidiaProviderError(
          "AI_PROVIDER_ERROR",
          INVALID_RESPONSE_MESSAGE,
          response.status
        );
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new NvidiaProviderError(
          "AI_PROVIDER_ERROR",
          INVALID_RESPONSE_MESSAGE,
          response.status
        );
      }

      // Parsing/validation of the model's task-plan JSON is deliberately a later task.
      return { content };
    }
  });
}
