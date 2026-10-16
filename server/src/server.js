import "dotenv/config";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT || "8787", 10);
const app = createApp();

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port number.");
}

app.listen(port, "127.0.0.1", () => {
  console.log("Flow Compiler API listening on 127.0.0.1:" + port);
});
