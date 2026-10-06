import path from "node:path";
import { mitLogMaske } from "./log-maske.js";

const STDIO_MCP_EINSTIEG = "mcp-server.js";

function describe(reasonOrErr) {
  if (reasonOrErr instanceof Error) return reasonOrErr.stack || reasonOrErr.message;
  return String(reasonOrErr);
}

export function onUnhandledRejection(reason) {
  console.error("[guard] unhandledRejection:", describe(reason));
}

export function onUncaughtException(err) {
  console.error("[guard] uncaughtException:", describe(err));
}

export function installProcessGuards() {
  process.stderr.write = mitLogMaske(process.stderr.write);
  if (path.basename(String(process.argv[1])) !== STDIO_MCP_EINSTIEG) process.stdout.write = mitLogMaske(process.stdout.write);
  process.removeListener("unhandledRejection", onUnhandledRejection);
  process.removeListener("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);
}

installProcessGuards();
