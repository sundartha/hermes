import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { staging } from "../../tools/deploy-weg/staging.mjs";

const COMMIT = "e2132525" + "a".repeat(32);
const ALT = "784cb330" + "b".repeat(32);
const PEM = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
const WARTET = `Staging meldet noch nicht den Commit ${COMMIT}, neuer Versuch nach dem Takt`;
const FRISTENDE = `Frist abgelaufen: Staging meldet Commit ${ALT}, erwartet war ${COMMIT}`;
const FRISTENDE_OHNE_STAND = `Frist abgelaufen: Staging meldet nicht den erwarteten Commit ${COMMIT}`;
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

async function laufen({ statusCommit = COMMIT, authPin = false, pinTakte = { taktMs: 20_000, fristMs: 60_000 } }) {
  const antwort = createServer((anfrage, rueckgabe) => {
    let code = 404;
    let koerper = {};
    if (anfrage.url === "/healthz") [code, koerper] = [200, { ok: true, commit: COMMIT }];
    else if (anfrage.url === "/intern/status")
      [code, koerper] = [200, { datenbank: true, flush: true, commit: statusCommit, telnyxSignaturSchluessel: "ok" }];
    else if (anfrage.url === "/mcp") code = 401;
    else if (anfrage.url.startsWith("/voice/")) code = 403;
    rueckgabe.writeHead(code, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(koerper));
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  const zeilen = [];
  const ergebnis = await staging({
    einstellungen: {
      stagingUrl: `http://127.0.0.1:${antwort.address().port}`,
      statusToken: "s".repeat(40),
      telnyxSchluessel: PEM,
      absichtlichRot: false,
    },
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr: { jetzt: () => 1_700_000_000_000, warten: async () => undefined },
    pinTakte,
    probeAuth: async ({ ausgabe }) => {
      if (!authPin) return 0;
      ausgabe.melde("probe_auth_zeile", { zeile: "ABBRUCH: Ziel-Pin verletzt: faehrt " + ALT.slice(0, 8) });
      return 2;
    },
  });
  return { ergebnis, zeilen };
}

test("Status meldet bis Fristende den alten Commit: rot mit Fristende-Zeile, die beide Commits nennt", async () => {
  const { ergebnis, zeilen } = await laufen({ statusCommit: ALT });
  assert.equal(ergebnis, false);
  assert.equal(zeilen.filter((zeile) => zeile === FRISTENDE).length, 1);
});

test("Status: drei Wartezeilen bei vier Versuchen, danach keine Wartezeile mehr", async () => {
  const { zeilen } = await laufen({ statusCommit: ALT });
  assert.equal(zeilen.filter((zeile) => zeile === WARTET).length, 3);
  assert.equal(zeilen.at(-1) === WARTET, false);
  assert.ok(zeilen.indexOf(FRISTENDE) > zeilen.lastIndexOf(WARTET));
});

test("Auth-Probe: drei Wartezeilen, danach Fristende-Zeile mit dem erwarteten Commit ohne gemeldeten", async () => {
  const { ergebnis, zeilen } = await laufen({ authPin: true });
  assert.equal(ergebnis, false);
  assert.equal(zeilen.filter((zeile) => zeile === WARTET).length, 3);
  assert.equal(zeilen.filter((zeile) => zeile === FRISTENDE_OHNE_STAND).length, 1);
  assert.ok(zeilen.indexOf(FRISTENDE_OHNE_STAND) > zeilen.lastIndexOf(WARTET));
});

test("Staging meldet sofort den erwarteten Commit: weder Wartezeile noch Fristende-Zeile", async () => {
  const { ergebnis, zeilen } = await laufen({});
  assert.equal(ergebnis, true);
  assert.equal(zeilen.some((zeile) => zeile.startsWith("Frist abgelaufen") || zeile === WARTET), false);
});

test("Frist null: der einzige Versuch ist der letzte und meldet nur die Fristende-Zeile", async () => {
  const { zeilen } = await laufen({ statusCommit: ALT, pinTakte: { taktMs: 20_000, fristMs: 0 } });
  assert.equal(zeilen.includes(WARTET), false);
  assert.ok(zeilen.includes(FRISTENDE));
});
