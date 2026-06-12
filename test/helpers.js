// Test-Helpers: Server als Kindprozess starten (PORT=0 -> echten Port aus dem
// Log parsen), Store-Seeding in ein Temp-DATA_DIR und Requests ueber die
// externe Interface-IP (fuer Tests, die NICHT als localhost gelten sollen).
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 15000;

// ALLE config-relevanten Env-Variablen explizit setzen: dotenv fuellt nur
// UNgesetzte Variablen, so kann eine lokale .env die Tests nicht beeinflussen.
export const BASE_ENV = {
  PORT: "0",
  DATA_DIR: "", // wird pro Server durch ein Temp-Verzeichnis ersetzt
  ANTHROPIC_API_KEY: "test-anthropic-key",
  CLAUDE_MODEL: "claude-haiku-4-5",
  MAX_BUDGET_EUR: "8",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
  TWILIO_NUMBER: "+15005550006",
  TWILIO_EDGE: "frankfurt",
  OWNER_NAME: "Jonas",
  OWNER_NUMBER: "",
  SEND_SMS_SUMMARY: "false",
  PUBLIC_URL: "https://agent.test",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  ALLOWED_NUMBERS: "",
  MAX_CALL_DURATION_S: "180",
  SKIP_TWILIO_SIGNATURE_CHECK: "true",
  RATE_LIMIT_PER_MIN: "1000",
  RETENTION_DAYS: "0",
  VOICE_ENGINE: "budget",
  OPENAI_API_KEY: "",
  REALTIME_MODEL: "gpt-realtime",
  REALTIME_VOICE: "alloy",
};

// Erste nicht-interne IPv4-Adresse - Requests dorthin gelten serverseitig
// nicht als localhost (req.socket.remoteAddress != 127.0.0.1).
export function externalIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

export function tempDataDir(seedState) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vodafone-agent-test-"));
  if (seedState) fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(seedState, null, 2));
  return dir;
}

// Minimal-vollstaendiger Store-Zustand zum Seeden einzelner Testfaelle
export function seedState({ calls = [], actionItems = [], notifications = [], settings = {} } = {}) {
  return {
    settings: {
      agentName: "Vodafone Agent",
      greeting: "Hallo, hier ist der KI-Assistent von {owner}. Wie kann ich helfen?",
      allowCalendar: true,
      allowBooking: true,
      allowSummaries: true,
      allowPersonalData: false,
      allowBankData: false,
      ...settings,
    },
    calls,
    actionItems,
    calendar: [],
    usage: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: calls.length },
    notifications,
  };
}

export function seedCall(overrides = {}) {
  return {
    id: "call_test1",
    twilioSid: null,
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    goal: "Testziel",
    briefing: null,
    constraints: null,
    callerName: null,
    language: "de",
    maxDurationS: 60,
    status: "active",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
    ...overrides,
  };
}

// Startet src/server.js als Kindprozess und liefert Port, gesammeltes stdout
// und einen stop()-Handle. Wirft bei Startproblemen mit dem bisherigen Output.
export async function startServer({ env = {}, seed } = {}) {
  const dataDir = tempDataDir(seed);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = { text: "" };
  child.stdout.on("data", (d) => (output.text += d.toString()));
  child.stderr.on("data", (d) => (output.text += d.toString()));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server-Start Timeout. Output:\n${output.text}`)),
      STARTUP_TIMEOUT_MS
    );
    const onData = (d) => {
      const m = output.text.match(/laeuft auf http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(parseInt(m[1], 10));
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server vorzeitig beendet (code ${code}). Output:\n${output.text}`));
    });
  });

  return {
    port,
    dataDir,
    child,
    localUrl: `http://127.0.0.1:${port}`,
    externalUrl: externalIp() ? `http://${externalIp()}:${port}` : null,
    get stdout() {
      return output.text;
    },
    readStore() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    },
  };
}
