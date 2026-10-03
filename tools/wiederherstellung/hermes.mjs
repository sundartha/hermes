import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { setTimeout as warten } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SERVER = "src/server.js";
const BEOBACHTER = join(REPO, "test/helpers/netz-beobachter.cjs");
const LOKAL = "127.0.0.1";
const TOTE_ADRESSE = "http://127.0.0.1:9";
const HTTP_OK = 200;
const HEALTHZ_TAKTE = 15;
const HEALTHZ_TEILER = 20;
const RUHE_TAKTE = 1;
const ENDE_TAKTE = 3;
const ABRUF_FRIST_MS = 5000;
const ANBIETER_ADRESSEN = [
  "ANTHROPIC_BASE_URL",
  "ELEVENLABS_API_BASE",
  "TELNYX_API_BASE",
  "STRIPE_API_BASE",
  "EXA_API_BASE",
  "WORKOS_API_BASE",
];
const FESTE_WERTE = {
  NODE_ENV: "test",
  STORE_BACKEND: "pg",
  PUBLIC_URL: "https://wiederherstellung.invalid",
  ANTHROPIC_API_KEY: "wiederherstellung-platzhalter",
  PAYMENT_ENABLED: "false",
  PROVISIONING_ENABLED: "false",
  PROVISIONING_RETRY_MAX_ATTEMPTS: "0",
  PROVISIONING_RETRY_MIN_INTERVAL_MS: "0",
  RELEASE_GRACE_DAYS: "0",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  ELEVENLABS_INBOUND_ENABLED: "false",
  OUTBOUND_FROZEN: "true",
  SEND_SMS_SUMMARY: "false",
  METRICS_ENABLED: "false",
  PRICE_DRIFT_MIN_INTERVAL_MS: "0",
  OUTAGE_ALERT_WINDOW_MS: "0",
  INBOUND_OUTAGE_ALERT_WINDOW_MS: "0",
  OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
  PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
  PAID_WITHOUT_NUMBER_GRACE_MS: "0",
  COST_TRUING_SWEEP_INTERVAL_MS: "2147483647",
  COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control",
  RETENTION_DAYS: "0",
  DIAGNOSTIC_RETENTION_DAYS: "36500",
  EVIDENCE_RETENTION_DAYS: "36500",
};

function hermesUmgebung({ datenbankUrl, port, ordner, commit }) {
  const umgebung = {
    ...FESTE_WERTE,
    ...Object.fromEntries(ANBIETER_ADRESSEN.map((name) => [name, TOTE_ADRESSE])),
    DATABASE_URL: datenbankUrl,
    PORT: String(port),
    DATA_DIR: join(ordner, "hermes-data"),
    NODE_OPTIONS: "--require " + JSON.stringify(BEOBACHTER),
    NETZ_BEOBACHTER_LOG: join(ordner, "netz.jsonl"),
    PATH: env.PATH ?? "",
  };
  return commit ? { ...umgebung, RENDER_GIT_COMMIT: commit } : umgebung;
}

async function freierPort() {
  const server = createServer();
  await new Promise((fertig) => server.listen(0, LOKAL, fertig));
  const { port } = server.address();
  await new Promise((fertig) => server.close(fertig));
  return port;
}

async function healthzStatus(url) {
  try {
    const antwort = await fetch(url, { signal: AbortSignal.timeout(ABRUF_FRIST_MS) });
    await antwort.body?.cancel();
    return antwort.status;
  } catch {
    return null;
  }
}

async function ruhen(ms, signal) {
  try {
    await warten(ms, undefined, { signal });
    return true;
  } catch {
    return false;
  }
}

async function healthzAbwarten(url, { takt, laeuft, signal }) {
  const frist = Date.now() + HEALTHZ_TAKTE * takt;
  const abstand = Math.max(1, Math.floor(takt / HEALTHZ_TEILER));
  while (laeuft()) {
    if ((await healthzStatus(url)) === HTTP_OK) return true;
    if (Date.now() >= frist || !(await ruhen(abstand, signal))) return false;
  }
  return false;
}

export async function healthzPruefen(basisUrl, { takt, laeuft = () => true, signal }) {
  const url = basisUrl + "/healthz";
  if (!(await healthzAbwarten(url, { takt, laeuft, signal }))) return false;
  if (!(await ruhen(RUHE_TAKTE * takt, signal))) return false;
  return laeuft() && (await healthzStatus(url)) === HTTP_OK;
}

export function netzAuswerten(text) {
  const eintraege = text
    .split("\n")
    .filter((zeile) => zeile.trim() !== "")
    .map((zeile) => {
      try {
        return JSON.parse(zeile);
      } catch {
        return { extern: true };
      }
    });
  return {
    aktiv: eintraege.some((eintrag) => eintrag?.art === "start"),
    extern: eintraege.filter((eintrag) => eintrag?.extern !== false).length,
    envDatei: eintraege.filter((eintrag) => eintrag?.art === "env-datei").length,
  };
}

function netzLesen(ordner) {
  try {
    return netzAuswerten(readFileSync(join(ordner, "netz.jsonl"), "utf8"));
  } catch {
    return { aktiv: false, extern: 0, envDatei: 0 };
  }
}

async function beenden(kind, takt) {
  if (kind.exitCode !== null || kind.signalCode !== null) return kind.exitCode;
  kind.kill("SIGTERM");
  try {
    const [code] = await once(kind, "exit", { signal: AbortSignal.timeout(ENDE_TAKTE * takt) });
    return code;
  } catch {
    kind.kill("SIGKILL");
    return null;
  }
}

function starten(ordner, port, rahmen) {
  const log = openSync(join(ordner, "hermes.log"), "w");
  try {
    const umgebung = hermesUmgebung({ ...rahmen, port, ordner });
    return spawn(process.execPath, [SERVER], {
      cwd: REPO,
      env: umgebung,
      stdio: ["ignore", log, log],
    });
  } finally {
    closeSync(log);
  }
}

export async function hermesPruefen({ datenbankUrl, takt, commit, signal }) {
  const ordner = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), "wiederherstellung-"));
  mkdirSync(join(ordner, "hermes-data"));
  let kind = null;
  try {
    const port = await freierPort();
    kind = starten(ordner, port, { datenbankUrl, commit });
    kind.on("error", () => {});
    const laeuft = () => kind.exitCode === null && kind.signalCode === null && !signal?.aborted;
    const h1 = await healthzPruefen("http://" + LOKAL + ":" + port, { takt, laeuft, signal });
    const code = await beenden(kind, takt);
    return { h1, h2: netzLesen(ordner), h3: code === 0 };
  } finally {
    if (kind !== null && kind.exitCode === null && kind.signalCode === null) kind.kill("SIGKILL");
    rmSync(ordner, { recursive: true, force: true });
  }
}
