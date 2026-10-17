import { config as loadEnv } from "dotenv";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp, readRateLimitConfig, parseAllowedOrigins } from "./app.js";

// Resolve server/.env independently of the caller's working directory.
// Hosting-provided environment variables retain precedence.
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

export function startServer(options = {}) {
  const env = options.env ?? process.env;
  // Fail closed on malformed explicit limiter or origin configuration.
  const rateLimit = readRateLimitConfig(env);
  const allowedOrigins = parseAllowedOrigins(env.APP_ORIGINS ?? env.APP_ORIGIN);
  const port = options.port ?? Number.parseInt(env.PORT || "8787", 10);
  // Preserve loopback for local development, but bind publicly by default in
  // production container hosting (e.g. Render). An explicit HOST always wins.
  const defaultHost = env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  const host = options.host || env.HOST || defaultHost;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port number.");
  }

  return createApp({ env, allowedOrigins, rateLimit }).listen(port, host);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const server = startServer();
    server.once("listening", () => {
      const address = server.address();
      console.log("Flow Compiler API listening on " + address.address + ":" + address.port);
    });
    server.once("error", error => {
      console.error("Flow Compiler API failed to start:", error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error("Flow Compiler API configuration error:", error.message);
    process.exitCode = 1;
  }
}
