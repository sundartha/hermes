import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUSFALLPROBE_SCHLUESSEL } from "../../test/gemeinsam/erfundene-geheimnisse.js";
import { ANFRAGE_FRIST_MS, BEREIT_FRIST_MS } from "./schwellen.mjs";
import { LOOPBACK } from "./ziel.mjs";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, "../..");
const NUR_LOOPBACK = pathToFileURL(path.join(HIER, "nur-loopback.mjs")).href;
const BEREIT_TAKT_MS = 200;
const HTTP_OK = 200;
const WIEDERHOLUNG = 2;
const STOPP_FRIST_MS = 10_000;
const REGISTRIERUNG = "phnum_ausfallprobe";

function speicher(datenbankUrl) {
  if (!datenbankUrl) return { STORE_BACKEND: "json" };
  return { STORE_BACKEND: "pg", DATABASE_URL: datenbankUrl };
}

export function kindUmgebung({ weicheUrl, datenVerzeichnis, port, datenbankUrl }) {
  return {
    ...speicher(datenbankUrl),
    NODE_ENV: "production",
    HOME: datenVerzeichnis,
    DATA_DIR: datenVerzeichnis,
    COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control",
    PORT: String(port),
    PUBLIC_URL: `http://${LOOPBACK}:${port}`,
    OUTBOUND_FROZEN: "true",
    BOOTSTRAP_E164: "+4915100000001",
    BOOTSTRAP_PROVIDER: "telnyx",
    SESSION_SECRET: AUSFALLPROBE_SCHLUESSEL.repeat(WIEDERHOLUNG),
    ANTHROPIC_API_KEY: AUSFALLPROBE_SCHLUESSEL,
    TELNYX_API_KEY: AUSFALLPROBE_SCHLUESSEL,
    ELEVENLABS_API_KEY: AUSFALLPROBE_SCHLUESSEL,
    ELEVENLABS_AGENT_ID: "agent_ausfallprobe",
    ELEVENLABS_INBOUND_ENABLED: "true",
    ELEVENLABS_INBOUND_SIP_USER: "ausfallprobe",
    ELEVENLABS_INBOUND_SIP_PASSWORD: AUSFALLPROBE_SCHLUESSEL,
    ELEVENLABS_INIT_WEBHOOK_TOKEN: AUSFALLPROBE_SCHLUESSEL.repeat(WIEDERHOLUNG),
    ANTHROPIC_BASE_URL: weicheUrl,
    ELEVENLABS_API_BASE: weicheUrl,
    TELNYX_API_BASE: weicheUrl,
    STRIPE_API_BASE: weicheUrl,
    WORKOS_API_BASE: weicheUrl,
    EXA_API_BASE: weicheUrl,
  };
}

export function legeDatenVerzeichnisAn() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ausfallprobe-"));
}

export function raeumeDatenVerzeichnisAuf(datenVerzeichnis) {
  fs.rmSync(datenVerzeichnis, { recursive: true, force: true });
}

export function legeCodeKopieAn(datenVerzeichnis) {
  const kopie = fs.mkdtempSync(path.join(datenVerzeichnis, "code-"));
  fs.cpSync(path.join(WURZEL, "src"), path.join(kopie, "src"), { recursive: true });
  for (const name of ["package.json", "node_modules", "public"])
    fs.symlinkSync(path.join(WURZEL, name), path.join(kopie, name));
  return kopie;
}

export function saeNummer(datenVerzeichnis) {
  const datei = path.join(datenVerzeichnis, "store.json");
  const zustand = JSON.parse(fs.readFileSync(datei, "utf8"));
  for (const nummer of zustand.numbers) nummer.providerAgentPhoneNumberId = REGISTRIERUNG;
  fs.writeFileSync(datei, JSON.stringify(zustand));
}

function freierPort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, LOOPBACK, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const SCHADEN_WERTE = ["fehler", "event-loop", "pool"];

async function leseSchaden(antwort) {
  if (antwort.status === HTTP_OK) return null;
  const koerper = await antwort.json().catch(() => null);
  return SCHADEN_WERTE.includes(koerper?.schaden) ? koerper.schaden : null;
}

export function messeHealthz(url) {
  const start = performance.now();
  return fetch(`${url}/healthz`, { signal: AbortSignal.timeout(ANFRAGE_FRIST_MS) }).then(
    async (antwort) => ({
      status: antwort.status,
      schaden: await leseSchaden(antwort),
      ms: Math.round(performance.now() - start),
    }),
    () => ({ status: null, schaden: null, ms: Math.round(performance.now() - start) }),
  );
}

const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function starteKind({ weicheUrl, datenVerzeichnis, datenbankUrl }) {
  const port = await freierPort();
  const umgebung = kindUmgebung({ weicheUrl, datenVerzeichnis, port, datenbankUrl });
  const kopie = legeCodeKopieAn(datenVerzeichnis);
  const prozess = spawn(process.execPath, ["--import", NUR_LOOPBACK, "src/server.js"], {
    cwd: kopie,
    env: umgebung,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ausgabe = { text: "" };
  for (const strom of [prozess.stdout, prozess.stderr])
    strom.on("data", (stueck) => (ausgabe.text += stueck));
  const beendet = new Promise((resolve) => prozess.once("exit", resolve));
  return { prozess, port, umgebung, kopie, ausgabe, beendet, url: `http://${LOOPBACK}:${port}` };
}

export async function warteBereit(kind) {
  const frist = Date.now() + BEREIT_FRIST_MS;
  while (Date.now() < frist) {
    if (kind.prozess.exitCode !== null) return false;
    if ((await messeHealthz(kind.url)).status === HTTP_OK) return true;
    await warte(BEREIT_TAKT_MS);
  }
  return false;
}

export async function stoppeKind(kind) {
  if (kind.prozess.exitCode !== null) return;
  kind.prozess.kill("SIGTERM");
  const hartAb = setTimeout(() => kind.prozess.kill("SIGKILL"), STOPP_FRIST_MS);
  await kind.beendet;
  clearTimeout(hartAb);
}
