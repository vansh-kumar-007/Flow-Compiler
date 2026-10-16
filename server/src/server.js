import { config as loadEnv } from "dotenv";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp } from "./app.js";

// Resolve the documented server/.env path independently of the caller's working directory.
// Hosting-provided environment variables take precedence because dotenv's override default is false.
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

export function startServer(options = {}) {
  const port = options.port ?? Number.parseInt(process.env.PORT || "8787", 10);
  const host = options.host || process.env.HOST || "127.0.0.1";

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port number.");
  }

  return createApp().listen(port, host);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = startServer();
  server.once("listening", () => {
    const address = server.address();
    console.log("Flow Compiler API listening on " + address.address + ":" + address.port);
  });
  server.once("error", error => {
    console.error("Flow Compiler API failed to start:", error.message);
    process.exitCode = 1;
  });
}
