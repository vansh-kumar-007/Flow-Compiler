import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import { validatePlanRequest } from "./plan-request.js";
import { createNvidiaClient, NvidiaProviderError } from "./nvidia-client.js";
import { createPlanMessages } from "./plan-prompt.js";
import { validateGeneratedPlan } from "./plan-output.js";
import { validateGeneratedDependencies } from "./dependency-graph.js";
import { validateGeneratedSchedule } from "./schedule-output.js";

const DEFAULT_ORIGINS = ["http://localhost:5173"];
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 10;
const MAX_RATE_LIMIT_WINDOW_MS = 86_400_000;
const MAX_RATE_LIMIT_MAX = 10_000;
const ORIGIN_PATTERN = /^https?:\/\/[^\s,]+$/i;

function parsePositiveInteger(value, name, { min, max, fallback }) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} must be configured.`);
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= min && value <= max) return value;
    throw new Error(`${name} is outside its supported range.`);
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be a positive decimal integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} is outside its supported range.`);
  }
  return parsed;
}

export function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error("APP_ORIGINS contains an invalid origin.");
  }
  if (value === "*" || value.includes("*") || value.includes(",")) {
    throw new Error("APP_ORIGINS does not allow wildcard or list values within one origin.");
  }
  if (!ORIGIN_PATTERN.test(value)) {
    throw new Error("APP_ORIGINS must contain HTTP(S) origins.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("APP_ORIGINS contains an invalid URL.");
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin === "null" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("APP_ORIGINS must contain origins only, without credentials, path, query, or fragment.");
  }
  if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Non-local APP_ORIGINS must use HTTPS.");
  }

  return parsed.origin;
}

export function parseAllowedOrigins(value = process.env.APP_ORIGINS ?? process.env.APP_ORIGIN) {
  if (value === undefined || value === null) return [...DEFAULT_ORIGINS];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("APP_ORIGINS must be a non-empty comma-separated string when configured.");
  }
  const entries = value.split(",").map(entry => entry.trim());
  if (entries.some(entry => !entry)) throw new Error("APP_ORIGINS contains an empty origin.");
  const normalized = entries.map(normalizeOrigin);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("APP_ORIGINS contains duplicate origins after normalization.");
  }
  return normalized;
}

export function readRateLimitConfig(env = process.env) {
  const windowMs = parsePositiveInteger(env.API_RATE_LIMIT_WINDOW_MS, "API_RATE_LIMIT_WINDOW_MS", {
    min: 1_000, max: MAX_RATE_LIMIT_WINDOW_MS, fallback: DEFAULT_RATE_LIMIT_WINDOW_MS
  });
  const limit = parsePositiveInteger(env.API_RATE_LIMIT_MAX, "API_RATE_LIMIT_MAX", {
    min: 1, max: MAX_RATE_LIMIT_MAX, fallback: DEFAULT_RATE_LIMIT_MAX
  });
  return { windowMs, limit };
}

function readBearerCredential(request) {
  // Reject repeated Authorization headers instead of guessing which credential
  // the HTTP stack intended. Never log or reflect the supplied value.
  const values = [];
  const rawHeaders = request.rawHeaders ?? [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === "authorization") {
      values.push(rawHeaders[index + 1]);
    }
  }
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(values[0]);
  return match ? match[1] : null;
}

function constantTimeCredentialMatch(supplied, configured) {
  if (typeof supplied !== "string" || typeof configured !== "string") return false;
  // The configured token is required to be a 32-byte base64url token (43 chars)
  // or longer. Compare equal-length ASCII buffers with Node's constant-time API.
  if (!ACCESS_TOKEN_PATTERN.test(configured) || !ACCESS_TOKEN_PATTERN.test(supplied)) return false;
  const suppliedBytes = Buffer.from(supplied, "ascii");
  const configuredBytes = Buffer.from(configured, "ascii");
  if (suppliedBytes.length !== configuredBytes.length) return false;
  return timingSafeEqual(suppliedBytes, configuredBytes);
}

function createPlanAuthenticationMiddleware(env) {
  return function requirePlanAuthentication(request, response, next) {
    response.set("Cache-Control", "no-store");
    const configured = typeof env.FLOW_COMPILER_ACCESS_TOKEN === "string"
      ? env.FLOW_COMPILER_ACCESS_TOKEN
      : "";
    // Fail closed while still allowing a no-secret deployment to pass health checks.
    if (!ACCESS_TOKEN_PATTERN.test(configured)) {
      return response.status(503).json({
        error: {
          code: "AUTHENTICATION_NOT_CONFIGURED",
          message: "Plan API authentication is not configured."
        }
      });
    }

    const supplied = readBearerCredential(request);
    if (!supplied || !constantTimeCredentialMatch(supplied, configured)) {
      return response.status(401).json(UNAUTHORIZED_BODY);
    }
    return next();
  };
}

function createInMemoryRateLimiter({ windowMs, limit, now = Date.now }) {
  const buckets = new Map();
  let sweepAt = 0;

  return function rateLimitMiddleware(request, response, next) {
    const currentTime = now();
    if (currentTime >= sweepAt) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= currentTime) buckets.delete(key);
      }
      sweepAt = currentTime + Math.min(windowMs, 60_000);
    }

    // Key by direct socket peer; Express proxy trust is disabled so untrusted
    // X-Forwarded-For headers cannot be used to manufacture new identities.
    const identity = request.socket.remoteAddress || "unknown";
    let bucket = buckets.get(identity);
    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = { count: 0, resetAt: currentTime + windowMs };
      buckets.set(identity, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - currentTime) / 1000));
    response.set("RateLimit-Policy", `${limit};w=${Math.ceil(windowMs / 1000)}`);
    response.set("RateLimit-Limit", String(limit));
    response.set("RateLimit-Remaining", String(remaining));
    response.set("RateLimit-Reset", String(resetSeconds));
    response.set("Cache-Control", "no-store");

    if (bucket.count > limit) {
      response.set("Retry-After", String(resetSeconds));
      return response.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many API requests. Please try again later."
        }
      });
    }
    return next();
  };
}

export function createApp(options = {}) {
  const app = express();
  const env = options.env ?? process.env;
  const planClient = options.planClient ?? createNvidiaClient({ env, fetchImpl: options.fetchImpl });
  const allowedOrigins = options.allowedOrigins
    ? options.allowedOrigins.map(normalizeOrigin)
    : options.allowedOrigin
      ? [normalizeOrigin(options.allowedOrigin)]
      : parseAllowedOrigins(env.APP_ORIGINS ?? env.APP_ORIGIN);
  const rateLimitConfig = options.rateLimit ?? readRateLimitConfig(env);
  const now = options.now ?? Date.now;

  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new Error("At least one trusted APP_ORIGINS origin is required.");
  }
  if (new Set(allowedOrigins).size !== allowedOrigins.length) {
    throw new Error("Trusted origins must be unique after normalization.");
  }
  if (
    !rateLimitConfig ||
    !Number.isSafeInteger(rateLimitConfig.windowMs) ||
    rateLimitConfig.windowMs < 1_000 ||
    rateLimitConfig.windowMs > MAX_RATE_LIMIT_WINDOW_MS ||
    !Number.isSafeInteger(rateLimitConfig.limit) ||
    rateLimitConfig.limit < 1 ||
    rateLimitConfig.limit > MAX_RATE_LIMIT_MAX
  ) {
    throw new Error("API rate-limit configuration is invalid.");
  }

  app.disable("x-powered-by");

  const rateLimitMiddleware = createInMemoryRateLimiter({ ...rateLimitConfig, now });
  // Quota all API traffic before CORS preflight handling and JSON parsing.
  app.use((request, response, next) => {
    if (request.path.startsWith("/api/")) return rateLimitMiddleware(request, response, next);
    return next();
  });

  app.use(cors({
    origin(origin, callback) {
      // Non-browser clients may omit Origin and still use the API, without CORS headers.
      if (origin === undefined) return callback(null, false);
      let normalized;
      try {
        normalized = normalizeOrigin(origin);
      } catch {
        return callback(null, false);
      }
      return callback(null, allowedOrigins.includes(normalized));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization"],
    optionsSuccessStatus: 204
  }));

  // Authenticate plan requests before parsing or validating their body. The
  // public health route remains unauthenticated; OPTIONS preflights are handled
  // by CORS and do not require the application token.
  const requirePlanAuthentication = createPlanAuthenticationMiddleware(env);
  app.use((request, response, next) => {
    if (request.method === "POST" && request.path === "/api/plan") {
      return requirePlanAuthentication(request, response, next);
    }
    return next();
  });

  app.use(express.json({ limit: "20kb", strict: true }));

  app.get("/api/health", (_request, response) => {
    response.status(200).json({
      status: "ok",
      service: "flow-compiler-api"
    });
  });

  // Validate public input before any provider call. The provider adapter performs
  // bounded I/O and ordered model/schema/dependency/schedule validation.
  app.post("/api/plan", async (request, response) => {
    const validationError = validatePlanRequest(request.body);
    if (validationError) {
      return response.status(400).json({ error: validationError });
    }

    const previousPlan = request.body.previousPlan ?? null;
    const completedTaskIds = previousPlan?.completedTaskIds ?? [];
    const revisionContext = previousPlan?.revisionContext ?? null;

    try {
      const result = await planClient.createChatCompletion({
        messages: createPlanMessages({
          brainDump: request.body.brainDump,
          availableMinutes: request.body.availableMinutes,
          previousPlan
        }),
        completedTaskIds,
        availableMinutes: request.body.availableMinutes,
        revisionContext
      });

      const plan = result?.output;
      // Defense in depth: injected clients and future adapter changes must not
      // bypass the same validators enforced inside the NVIDIA adapter.
      if (
        validateGeneratedPlan(plan) ||
        validateGeneratedDependencies(plan, { completedTaskIds }) ||
        validateGeneratedSchedule(plan, {
          availableMinutes: request.body.availableMinutes,
          revisionContext
        })
      ) {
        throw new NvidiaProviderError("INVALID_MODEL_OUTPUT");
      }

      return response.status(200).json(plan);
    } catch (error) {
      if (error instanceof NvidiaProviderError) {
        const status = error.code === "AI_NOT_CONFIGURED"
          ? 500
          : error.code === "AI_TIMEOUT"
            ? 504
            : 502;
        return response.status(status).json({
          error: { code: error.code, message: error.message }
        });
      }

      return response.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected server error occurred."
        }
      });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found."
      }
    });
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error?.type === "entity.too.large") {
      return response.status(413).json({
        error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." }
      });
    }
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      return response.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body must be valid JSON." }
      });
    }
    return response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." }
    });
  });

  return app;
}
