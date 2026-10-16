import cors from "cors";
import express from "express";
import { validatePlanRequest } from "./plan-request.js";

export function createApp(options = {}) {
  const app = express();
  const allowedOrigin = options.allowedOrigin || process.env.APP_ORIGIN || "http://localhost:5173";

  app.disable("x-powered-by");
  app.use(cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"]
  }));
  app.use(express.json({ limit: "20kb", strict: true }));

  app.get("/api/health", (_request, response) => {
    response.status(200).json({
      status: "ok",
      service: "flow-compiler-api"
    });
  });

  // Validate public input now, even while the provider integration remains unavailable.
  // A well-formed request receives 501 until the AI adapter is implemented.
  app.post("/api/plan", (request, response) => {
    const validationError = validatePlanRequest(request.body);
    if (validationError) {
      return response.status(400).json({ error: validationError });
    }

    return response.status(501).json({
      error: {
        code: "PLANNING_NOT_IMPLEMENTED",
        message: "AI planning is not available yet."
      }
    });
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
    if (response.headersSent) {
      return next(error);
    }

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
