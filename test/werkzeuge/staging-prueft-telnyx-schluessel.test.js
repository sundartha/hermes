import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import { staging } from "../../tools/deploy-weg/staging.mjs";

const COMMIT = "a".repeat(40);
const STATUS_TOKEN = "t".repeat(40);
const PEM = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_UNAVAILABLE = 503;
const HTTP_FORBIDDEN = 403;
const voiceAufrufe = [];
const GESUND = { datenbank: true, flush: true, commit: COMMIT };
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

async function laufen({ status = [HTTP_OK, { ...GESUND, telnyxSignaturSchluessel: "ok" }], token = STATUS_TOKEN }) {
  const gesehen = [];
  voiceAufrufe.length = 0;
  const antwort = createServer((anfrage, rueckgabe) => {
    gesehen.push({ pfad: anfrage.url, authorization: anfrage.headers.authorization, zwischenspeicher: anfrage.headers["cache-control"] });
    const [code, koerper] = routeFuer(anfrage, status);
    rueckgabe.writeHead(code, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(koerper));
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  const zeilen = [];
  const ergebnis = await staging({
    einstellungen: {
      stagingUrl: `http://127.0.0.1:${antwort.address().port}`,
      statusToken: token,
      telnyxSchluessel: PEM,
      absichtlichRot: false,
    },
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    probeAuth: async () => 0,
  });
  return { ergebnis, zeilen, gesehen };
}

function routeFuer(anfrage, status) {
  if (anfrage.url === "/healthz") return [HTTP_OK, { ok: true, commit: COMMIT }];
  if (anfrage.url === "/mcp") return [HTTP_UNAUTHORIZED, {}];
  if (anfrage.url.startsWith("/voice/")) return [voiceAufrufe.push(anfrage.url) % 2 === 1 ? HTTP_OK : HTTP_FORBIDDEN, {}];
  if (anfrage.url === "/intern/status") {
    return anfrage.headers.authorization === `Bearer ${STATUS_TOKEN}` ? status : [HTTP_UNAUTHORIZED, {}];
  }
  return [404, {}];
}

test("Staging gruen, wenn /intern/status den Telnyx-Schluessel als ok meldet, und der Status wird mit dem Token gelesen", async () => {
  const { ergebnis, gesehen, zeilen } = await laufen({});
  assert.equal(ergebnis, true);
  assert.deepEqual(
    gesehen.filter((e) => e.pfad === "/intern/status"),
    [{ pfad: "/intern/status", authorization: `Bearer ${STATUS_TOKEN}`, zwischenspeicher: "no-store" }],
  );
  assert.ok(zeilen.includes("Telnyx-Signaturschlüssel laut /intern/status: HTTP 200, ok: ja"));
});

const ROT = [
  ["Schluessel fehlt", [HTTP_OK, { ...GESUND, telnyxSignaturSchluessel: "fehlt" }], "nein"],
  ["Feld fehlt in der Antwort", [HTTP_OK, GESUND], "nein"],
  ["Status nicht lesbar (401)", [HTTP_UNAUTHORIZED, {}], "nein"],
  ["Status 503 trotz ok-Feld", [HTTP_UNAVAILABLE, { ...GESUND, telnyxSignaturSchluessel: "ok" }], "nein"],
];

for (const [name, status, ok] of ROT) {
  test(`Staging rot: ${name}`, async () => {
    const { ergebnis, zeilen } = await laufen({ status });
    assert.equal(ergebnis, false);
    assert.ok(zeilen.some((zeile) => zeile.startsWith("Telnyx-Signaturschlüssel laut /intern/status") && zeile.endsWith(`ok: ${ok}`)));
  });
}

test("Staging rot, wenn kein Status-Token vorliegt", async () => {
  const { ergebnis } = await laufen({ token: null });
  assert.equal(ergebnis, false);
});

const BASIS_UMGEBUNG = {
  STAGING_URL: "http://127.0.0.1:4000",
  STAGING_TELNYX_PRIVATE_KEY: PEM,
  GITHUB_TOKEN: "g",
  GITHUB_REPOSITORY: "sundartha/hermes",
};

test("Einstellungen staging: das Status-Token muss gesetzt und mindestens 32 Zeichen lang sein", () => {
  const lesen = (umgebung) => {
    const zeilen = [];
    try {
      return { einstellungen: einstellungenLesen("staging", umgebung, ausgabeAnlegen((zeile) => zeilen.push(zeile))), zeilen };
    } catch {
      return { einstellungen: null, zeilen };
    }
  };
  assert.equal(lesen({ ...BASIS_UMGEBUNG, STAGING_STATUS_TOKEN: STATUS_TOKEN }).einstellungen.statusToken, STATUS_TOKEN);
  assert.equal(lesen({ ...BASIS_UMGEBUNG, STAGING_STATUS_TOKEN: "t".repeat(32) }).einstellungen.statusToken, "t".repeat(32));
  for (const wert of [undefined, "", "t".repeat(31)]) {
    const { einstellungen, zeilen } = lesen({ ...BASIS_UMGEBUNG, STAGING_STATUS_TOKEN: wert });
    assert.equal(einstellungen, null);
    assert.deepEqual(zeilen, ["Einstellung fehlt oder ist ungültig: STAGING_STATUS_TOKEN"]);
  }
});
