import { getInputError, getTimeError, validatePlanResponse } from "./plan-ui.js";

const API_ERROR_MESSAGES = Object.freeze({
  UNAUTHORIZED: "Access token rejected. Check it and try again.",
  AUTHENTICATION_NOT_CONFIGURED: "Backend access-token authentication is not configured yet.",
  AI_NOT_CONFIGURED: "Access was accepted, but the backend has no NVIDIA API key configured. No plan was generated.",
  RATE_LIMIT_EXCEEDED: "Too many API requests. Wait before trying again.",
  AI_TIMEOUT: "The AI request timed out. No plan was accepted; you can retry.",
  AI_RATE_LIMITED: "The AI provider is rate-limited. Wait before trying again.",
  AI_NETWORK_ERROR: "The AI provider could not be reached. No plan was generated.",
  AI_ACCESS_DENIED: "The AI provider denied access to the requested resource.",
  AI_PROVIDER_UNAVAILABLE: "The AI provider is temporarily unavailable.",
  AI_RESPONSE_TOO_LARGE: "The AI provider returned a response that was too large.",
  AI_INVALID_RESPONSE: "The AI provider returned an invalid response.",
  INVALID_MODEL_OUTPUT: "The AI provider returned a plan that failed validation."
});

export class PlanningApiError extends Error {
  constructor(message, { code = "PLANNING_REQUEST_FAILED", status = null } = {}) {
    super(message);
    this.name = "PlanningApiError";
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

export async function requestPlan({
  fetchImpl,
  url,
  token,
  brainDump,
  availableMinutes,
  signal
}) {
  const credential = typeof token === "string" ? token.trim() : "";
  if (!credential) {
    throw new PlanningApiError("Enter your session access token to authorize this request.", { code: "MISSING_ACCESS_TOKEN" });
  }

  const inputError = getInputError(brainDump);
  const timeError = getTimeError(availableMinutes);
  if (inputError || timeError) {
    throw new PlanningApiError(inputError || timeError, { code: "INVALID_REQUEST" });
  }
  if (typeof url !== "string" || !url.endsWith("/api/plan")) {
    throw new PlanningApiError("The configured planning API URL is invalid.", { code: "INVALID_API_URL" });
  }
  if (typeof fetchImpl !== "function") {
    throw new PlanningApiError("Could not reach the planning API. Check the backend URL and allowed origin.", { code: "NETWORK_ERROR" });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + credential
      },
      body: JSON.stringify({
        brainDump: brainDump.trim(),
        availableMinutes,
        previousPlan: null
      })
    });
  } catch {
    if (signal?.aborted) {
      throw new PlanningApiError("Planning request cancelled.", { code: "REQUEST_CANCELLED" });
    }
    throw new PlanningApiError("Could not reach the planning API. Check the backend URL and allowed origin.", { code: "NETWORK_ERROR" });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = payload?.error?.code;
    const message = API_ERROR_MESSAGES[code]
      || ("Planning request failed (HTTP " + response.status + (typeof code === "string" ? " · " + code : "") + ").");
    throw new PlanningApiError(message, {
      code: typeof code === "string" ? code : "PLANNING_REQUEST_FAILED",
      status: response.status
    });
  }

  const validationError = validatePlanResponse(payload, availableMinutes);
  if (validationError) {
    throw new PlanningApiError(
      "The backend returned a response that did not match the plan contract: " + validationError,
      { code: "INVALID_PLAN_RESPONSE", status: response.status }
    );
  }
  return payload;
}
