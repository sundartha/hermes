// Kern des briefing-bench: tools/list-Schnappschuss holen (echter Draht, stdio) und die
// Szenarien n-mal gegen ein Modell fahren. Kein Werkzeug wird ausgefuehrt.
import { createHash } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { SCENARIOS } from "./szenarien.mjs";
import { CALL_TOOLS, evaluateReply, summarize, totals } from "./metriken.mjs";

const MCP_SERVER_ENTRYPOINT = path.join("src", "mcp-server.js");
const RAW_TOOLS_RESULT = z.object({ tools: z.array(z.any()) });
// Der Kindprozess liest KEINE .env (NODE_ENV=test, s. src/config.js) und damit keine
// Schluessel oder Produktionswerte; die Karten-Bestaetigung ist an wie in Produktion, damit
// prepare_call registriert ist. Weitere Werte nur ausdruecklich ueber --env.
const SNAPSHOT_BASE_ENV = Object.freeze({ NODE_ENV: "test", MCP_UI_ENABLED: "true" });

// Holt tools/list und instructions ueber stdio aus dem Checkout unter repoDir - auch aus
// einem alten Stand (git worktree), solange dort src/mcp-server.js existiert.
export async function snapshotTools(repoDir, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: repoDir,
    env: { ...SNAPSHOT_BASE_ENV, ...extraEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: "briefing-bench", version: "0.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.request({ method: "tools/list" }, RAW_TOOLS_RESULT);
    return { tools, instructions: client.getInstructions() || "" };
  } finally {
    await client.close();
  }
}

export function callTools(snapshot) {
  const tools = CALL_TOOLS.map((name) => snapshot.tools.find((tool) => tool.name === name)).filter(
    Boolean,
  );
  if (!tools.length) throw new Error("Schnappschuss enthaelt weder prepare_call noch place_call.");
  return tools;
}

function fingerprint(tools, instructions) {
  return createHash("sha256").update(JSON.stringify({ tools, instructions })).digest("hex");
}

async function runScenario({ scenario, model, tools, system, runs: count }) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    runs.push(evaluateReply(scenario, await model.complete({ system, tools, scenario })));
  }
  return { id: scenario.id, klasse: scenario.klasse, summe: summarize(runs), laeufe: runs };
}

export async function runBench({ snapshot, model, runs, scenarios = SCENARIOS }) {
  const tools = callTools(snapshot);
  const system = snapshot.instructions;
  const results = [];
  for (const scenario of scenarios)
    results.push(await runScenario({ scenario, model, tools, system, runs }));
  return {
    modell: model.name,
    laeufeJeSzenario: runs,
    werkzeuge: tools.map((tool) => tool.name),
    fingerabdruck: fingerprint(tools, system),
    summe: totals(results),
    szenarien: results,
  };
}
