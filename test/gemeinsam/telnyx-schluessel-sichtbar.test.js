import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import {
  HTTP_OK,
  HTTP_SERVICE_UNAVAILABLE,
  SCHLUESSEL,
  COMMIT,
  abrufen,
  mitStatusroute,
} from "./statusroute-hilfe.mjs";

const SCHLUESSELPAAR = crypto.generateKeyPairSync("ed25519");
const SPKI_DER = SCHLUESSELPAAR.publicKey.export({ format: "der", type: "spki" });
const ROH_BASE64 = SPKI_DER.subarray(-32).toString("base64");
const PEM = SCHLUESSELPAAR.publicKey.export({ format: "pem", type: "spki" }).toString();
const UNGUELTIG = "abc-nicht-der-schluessel-wert";
const BOOT_WARNUNG = /\[boot\] Konfig-Warnung: [^\n]*TELNYX_PUBLIC_KEY[^\n]*Telnyx-Rueckmeldung wird mit 403 abgewiesen/;

const gesund = { pruefeVerbindung: async () => undefined, letzterFlushGelungen: async () => true };
const krank = { pruefeVerbindung: async () => Promise.reject(new Error("aus")), letzterFlushGelungen: async () => true };

function konfig(telnyxPublicKey) {
  return {
    auth: { statusToken: SCHLUESSEL, deployToken: "d".repeat(32) },
    server: { deployedCommit: COMMIT },
    telephony: telnyxPublicKey === undefined ? undefined : { telnyxPublicKey },
  };
}

async function status(speicher, telnyxPublicKey) {
  const { makeInternStatusRoutes } = await import("../../src/routes/intern-status.js");
  const { ergebnis } = await mitStatusroute(
    { speicher, makeInternStatusRoutes },
    { config: konfig(telnyxPublicKey) },
    (basis) => abrufen(basis),
  );
  return { code: ergebnis.status, koerper: JSON.parse(ergebnis.text), text: ergebnis.text };
}

const FAELLE = [
  ["gueltiger Rohschluessel (base64)", ROH_BASE64, "ok"],
  ["gueltiger Schluessel als PEM", PEM, "ok"],
  ["leer", "", "fehlt"],
  ["kein Ed25519-Wert", UNGUELTIG, "fehlt"],
  ["PEM-Kopf ohne lesbaren Schluessel", "-----BEGIN PUBLIC KEY-----\nzzzz\n-----END PUBLIC KEY-----", "fehlt"],
  ["base64 mit falscher Laenge", Buffer.alloc(31).toString("base64"), "fehlt"],
  ["Telefonie-Block fehlt", undefined, "fehlt"],
];

for (const [name, wert, erwartet] of FAELLE) {
  test(`/intern/status: Telnyx-Schluessel ${name} -> ${erwartet}, Code 200, nie der Wert`, async () => {
    const { code, koerper, text } = await status(gesund, wert);
    assert.equal(code, HTTP_OK);
    assert.equal(koerper.telnyxSignaturSchluessel, erwartet);
    if (wert) assert.equal(text.includes(wert), false);
  });
}

test("/intern/status: bei Datenbankfehler 503 wie bisher, das Feld steht trotzdem in der Antwort", async () => {
  const { code, koerper } = await status(krank, "");
  assert.equal(code, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(koerper.datenbank, false);
  assert.equal(koerper.telnyxSignaturSchluessel, "fehlt");
});

const BOOT_FAELLE = [
  ["leer", "", true],
  ["kein Ed25519-Wert", UNGUELTIG, true],
  ["gueltig", ROH_BASE64, false],
];

for (const [name, wert, warnt] of BOOT_FAELLE) {
  test(`Boot: TELNYX_PUBLIC_KEY ${name} -> ${warnt ? "Konfig-Warnung" : "keine Warnung"}, der Wert steht nie im Log`, async () => {
    const srv = await startServer({ env: { TELNYX_PUBLIC_KEY: wert } });
    try {
      const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(BOOT_WARNUNG.test(srv.stdout), warnt, srv.stdout);
      if (wert) assert.equal(srv.stdout.includes(wert), false);
    } finally {
      await srv.stop();
    }
  });
}

const API_SCHLUESSEL_FAELLE = [
  ["TELNYX_API_KEY", "leer", { TELNYX_API_KEY: "", ELEVENLABS_API_KEY: "el-geheim-wert-1" }, true],
  ["ELEVENLABS_API_KEY", "leer", { TELNYX_API_KEY: "tx-geheim-wert-1", ELEVENLABS_API_KEY: "" }, true],
  ["TELNYX_API_KEY", "gesetzt", { TELNYX_API_KEY: "tx-geheim-wert-1", ELEVENLABS_API_KEY: "el-geheim-wert-1" }, false],
  ["ELEVENLABS_API_KEY", "gesetzt", { TELNYX_API_KEY: "tx-geheim-wert-1", ELEVENLABS_API_KEY: "el-geheim-wert-1" }, false],
];

for (const [name, zustand, env, warnt] of API_SCHLUESSEL_FAELLE) {
  test(`Boot: ${name} ${zustand} -> ${warnt ? "Konfig-Warnung" : "keine Warnung"}, der Wert steht nie im Log`, async () => {
    const srv = await startServer({ env });
    try {
      await abrufMitFrist(`${srv.localUrl}/healthz`);
      const zeile = new RegExp(`\\[boot\\] Konfig-Warnung: [^\\n]*${name}`);
      assert.equal(zeile.test(srv.stdout), warnt, srv.stdout);
      for (const wert of ["tx-geheim-wert-1", "el-geheim-wert-1"])
        assert.equal(srv.stdout.includes(wert), false);
    } finally {
      await srv.stop();
    }
  });
}

const RSA_PEM = crypto
  .generateKeyPairSync("rsa", { modulusLength: 2048 })
  .publicKey.export({ format: "pem", type: "spki" })
  .toString();
const EC_PEM = crypto
  .generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .publicKey.export({ format: "pem", type: "spki" })
  .toString();

const ANDERER_TYP_FAELLE = [
  ["RSA-PEM", RSA_PEM],
  ["EC-PEM", EC_PEM],
];

for (const [name, wert] of ANDERER_TYP_FAELLE) {
  test(`/intern/status: Telnyx-Schluessel ${name} -> fehlt, nie der Wert`, async () => {
    const { code, koerper, text } = await status(gesund, wert);
    assert.equal(code, HTTP_OK);
    assert.equal(koerper.telnyxSignaturSchluessel, "fehlt");
    assert.equal(text.includes(wert), false);
  });

  test(`Boot: TELNYX_PUBLIC_KEY ${name} -> Konfig-Warnung, der Wert steht nie im Log`, async () => {
    const srv = await startServer({ env: { TELNYX_PUBLIC_KEY: wert } });
    try {
      const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`);
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(BOOT_WARNUNG.test(srv.stdout), true, srv.stdout);
      assert.equal(srv.stdout.includes(wert), false);
    } finally {
      await srv.stop();
    }
  });
}
