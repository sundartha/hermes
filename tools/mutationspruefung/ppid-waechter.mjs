import { setInterval as takt } from "node:timers/promises";

export const ABFRAGE_MS = 100;
const VORLAUF = new URL("../../test/gemeinsam/ppid-waechter-vorlauf.mjs", import.meta.url).href;
export const MCP_STDIO_ARGS = [`--import=${VORLAUF}`, "src/mcp-server.js"];

export async function wacheUeberPpid(eltern, beende) {
  for await (const erwartet of takt(ABFRAGE_MS, eltern)) {
    if (process.ppid !== erwartet) beende();
  }
}
