import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASE_ENV, startServer, waitForLog } from "../helpers.js";
import { maskRestrictedText } from "../../src/restricted-data.js";
import { hashEmail, maskNumber, maskNumbersInText } from "../../src/util.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KIND = path.join("test", "helpers", "logwege-kind.mjs");
const KIND_FRIST_MS = 20000;
const HTTP_FORBIDDEN = 403;
const HTTP_UNPROCESSABLE = 422;
const KENNUNG = 4915112345678;

const RUMPF_LAENGE = 40;
const GEHEIMNIS_TEILE = 4;
const NUMMER = "+4915112345678";
const PREMIUM_NUMMER = "+4990012345678";
const EMAIL = "probe.person@example.org";
const GEHEIMNIS = "geheim".repeat(GEHEIMNIS_TEILE);
const TELNYX_SCHLUESSEL = "KEY" + "P".repeat(RUMPF_LAENGE);
const ANBIETER_TOKEN = "sk-ant-" + "K".repeat(RUMPF_LAENGE);
const SERVER_TOKEN = "github_pat_" + "A".repeat(RUMPF_LAENGE);
const KERNZIFFERN = "1511234";
const TRENNER = /[ ()/-]|%20/g;
const LAUF_LAENGE = 10;
const EXPRESS_SCHREIBER = 2;

const lauf = (zeichen) => zeichen.repeat(LAUF_LAENGE);

const PROBEN = [
  ["Nummer E.164", NUMMER, NUMMER],
  ["Nummer mit Leerzeichen", "+49 151 1234 5678", "+49 151 1234 5678"],
  ["Nummer mit Bindestrichen", "+49-151-1234-5678", "+49-151-1234-5678"],
  ["Nummer mit Klammern", "+49 (151) 1234-5678", "+49 (151) 1234-5678"],
  ["Nummer prozentkodiert", "%2B4915112345678", "%2B4915112345678"],
  ["Nummer prozentkodiert mit %20", "%2B49%20151%2012345678", "%2B49%20151%2012345678"],
  ["Nummer als JSON-Escape", "\\u002b4915112345678", "\\u002b4915112345678"],
  ["Nummer national", "0151 12345678", "0151 12345678"],
  ["Nummer in JSON", `{"to":"${NUMMER}"}`, NUMMER],
  ["Nummer in URL-Abfrage", "?To=%2B4915112345678&From=%2B4915112345678", "%2B4915112345678"],
  ["Token AWS", "AKIA" + "Q".repeat(RUMPF_LAENGE), lauf("Q")],
  ["Token GitHub klassisch", "ghp_" + "G".repeat(RUMPF_LAENGE), lauf("G")],
  ["Token GitHub fein", "github_pat_" + "A".repeat(RUMPF_LAENGE), lauf("A")],
  ["Token Slack", "xoxb-" + "S".repeat(RUMPF_LAENGE), lauf("S")],
  ["Token Stripe", "sk_live_" + "T".repeat(RUMPF_LAENGE), lauf("T")],
  ["Token Google", "AIza" + "Z".repeat(RUMPF_LAENGE), lauf("Z")],
  ["Token sk-Schlüssel", ANBIETER_TOKEN, lauf("K")],
  ["Token JWT", ["eyJ" + "J".repeat(RUMPF_LAENGE), "J".repeat(RUMPF_LAENGE), "J".repeat(RUMPF_LAENGE)].join("."), lauf("J")],
  ["Bearer-Wert", "Bearer " + "B".repeat(RUMPF_LAENGE), lauf("B")],
  ["Webhook-Geheimnis", "whsec_" + "W".repeat(RUMPF_LAENGE), lauf("W")],
  ["x-hermes-tool-token", "x-hermes-tool-token: " + "H".repeat(RUMPF_LAENGE), lauf("H")],
  ["xi-api-key in JSON", `{"xi-api-key":"${"X".repeat(RUMPF_LAENGE)}"}`, lauf("X")],
  ["x-api-key", "x-api-key=" + "Y".repeat(RUMPF_LAENGE), lauf("Y")],
  ["authorization in JSON", `{"authorization":"Basic ${"C".repeat(RUMPF_LAENGE)}"}`, lauf("C")],
  ["E-Mail-Adresse", EMAIL, EMAIL],
  ["Geheimnis aus der Umgebung", GEHEIMNIS, GEHEIMNIS],
  ["Telnyx-Schlüssel aus der Umgebung", TELNYX_SCHLUESSEL, lauf("P")],
];

const WEGE = [
  ["console.log", 1],
  ["console.info", 1],
  ["console.debug", 1],
  ["console.warn", 1],
  ["console.error", 1],
  ["console.trace", 1],
  ["console.dir", 1],
  ["console.dirxml", 1],
  ["console.table", 1],
  ["console.assert", 1],
  ["console.group", 1],
  ["console.count", 1],
  ["console.timeLog", 1],
  ["stdout.write", 1],
  ["stderr.write", 1],
  ["audit", 1],
  ["emitWarning", 1],
  ["errorHandler", 1],
  ["express-nach-antwort", EXPRESS_SCHREIBER],
  ["async-route", 1],
  ["anbieter", 1],
  ["uncaughtException", 1],
  ["unhandledRejection", 1],
];

const wegVon = (zeile) => /\[weg:([^\]]+)\]/.exec(zeile)?.[1] ?? "ohne Wegmarke";

async function starteTelnyxAttrappe() {
  const server = http.createServer((anfrage, antwort) => {
    const detail = `phone_number ${NUMMER} token ${ANBIETER_TOKEN} auth ${anfrage.headers.authorization}`;
    antwort.writeHead(HTTP_UNPROCESSABLE, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ errors: [{ code: "10015", title: "[weg:anbieter] Invalid parameter", detail }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function fuehreKindAus(umgebung) {
  const kind = spawn(process.execPath, [KIND], {
    cwd: ROOT,
    env: umgebung,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: KIND_FRIST_MS,
  });
  const teile = { stdout: "", stderr: "" };
  kind.stdout.on("data", (stueck) => {
    teile.stdout += stueck;
  });
  kind.stderr.on("data", (stueck) => {
    teile.stderr += stueck;
  });
  const [code] = await once(kind, "close");
  return { code, ausgabe: `${teile.stdout}\n${teile.stderr}` };
}

function pruefeWege(zeilen) {
  for (const [weg, mindestens] of WEGE) {
    const treffer = zeilen.filter((zeile) => zeile.includes(`[weg:${weg}]`));
    assert.ok(treffer.length >= mindestens, `Weg ${weg}: Logzeile fehlt`);
    assert.ok(treffer.every((zeile) => zeile.includes("***")), `Weg ${weg}: Zeile ohne Maskierung`);
  }
}

function pruefeKeinKlartext(zeilen) {
  for (const [form, , klartext] of PROBEN) {
    const zeile = zeilen.find((kandidat) => kandidat.includes(klartext));
    assert.ok(zeile === undefined, `Klartext im Log: Form ${form}, Weg ${wegVon(zeile)}`);
  }
  const zeile = zeilen.find((kandidat) => kandidat.replace(TRENNER, "").includes(KERNZIFFERN));
  assert.ok(zeile === undefined, `Klartext im Log: Ziffern der Nummer, Weg ${wegVon(zeile)}`);
}

test("SG-13 jeder Logweg kommt maskiert an", async () => {
  const attrappe = await starteTelnyxAttrappe();
  try {
    const { code, ausgabe } = await fuehreKindAus({
      ...BASE_ENV,
      PATH: process.env.PATH,
      LOGWEG_NUTZLAST: PROBEN.map(([, text]) => text).join(" | "),
      LOGWEG_PROBE_SECRET: GEHEIMNIS,
      TELNYX_API_KEY: TELNYX_SCHLUESSEL,
      TELNYX_API_BASE: `http://127.0.0.1:${attrappe.address().port}`,
    });
    assert.equal(code, 0, "Kindprozess endet ohne Fehler");
    const zeilen = ausgabe.split("\n");
    pruefeWege(zeilen);
    pruefeKeinKlartext(zeilen);
  } finally {
    attrappe.close();
  }
});

test("SG-13 Server-Log enthält weder Nummer noch Token noch E-Mail im Klartext", async () => {
  const srv = await startServer();
  try {
    const abgelehnt = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: PREMIUM_NUMMER, objective: "Termin" }),
    });
    assert.equal(abgelehnt.status, HTTP_FORBIDDEN);
    await fetch(`${srv.localUrl}/api/calls/${SERVER_TOKEN}~${EMAIL}%E0%A4%A`);
    await waitForLog(srv, /place_call_denied/);
    await waitForLog(srv, /URIError/);
    const log = srv.stdout;
    assert.equal(log.includes(`to=${maskNumber(PREMIUM_NUMMER)}`), true, "Nummer fehlt in maskierter Form");
    assert.equal(maskNumbersInText(log) === log, true, "Nummern-Muster trifft im Server-Log");
    assert.equal(maskRestrictedText(log) === log, true, "Token-Muster trifft im Server-Log");
    assert.equal(log.includes(PREMIUM_NUMMER.slice(1)), false, "Nummer im Klartext im Server-Log");
    assert.equal(log.includes(SERVER_TOKEN), false, "Token im Klartext im Server-Log");
    assert.equal(log.includes(EMAIL), false, "E-Mail im Klartext im Server-Log");
    assert.equal(log.includes(`***@${hashEmail(EMAIL)}`), true, "E-Mail fehlt in maskierter Form");
  } finally {
    await srv.stop();
  }
});

test("SG-13 stdio-MCP-Server liefert eine lange Kennung unverändert auf stdout", async () => {
  const kind = spawn(process.execPath, [path.join("src", "mcp-server.js")], {
    cwd: ROOT,
    env: { ...BASE_ENV, PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "ignore"],
    timeout: KIND_FRIST_MS,
  });
  try {
    const zeilen = readline.createInterface({ input: kind.stdout });
    const anfrage = {
      jsonrpc: "2.0",
      id: KENNUNG,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sg13-probe", version: "0.0.0" } },
    };
    kind.stdin.write(`${JSON.stringify(anfrage)}\n`);
    const [antwort] = await once(zeilen, "line");
    assert.equal(JSON.parse(antwort).id, KENNUNG);
  } finally {
    kind.kill();
  }
});
