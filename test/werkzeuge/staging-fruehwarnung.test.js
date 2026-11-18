import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { staging } from "../../tools/deploy-weg/staging.mjs";

const COMMIT = "c".repeat(40);
const STATUS_TOKEN = "s".repeat(40);
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

async function starten({ vorher, fremdeBeiProbe, anrufe }) {
  const stand = { abgewiesen: vorher };
  const antwort = createServer((anfrage, rueckgabe) => {
    anfrage.resume();
    const pfad = new URL(anfrage.url, "http://127.0.0.1").pathname;
    let status = 200;
    let koerper = {};
    if (pfad === "/healthz") {
      koerper = { ok: true, commit: COMMIT, ...(stand.abgewiesen > 0 ? { webhooksAbgewiesen: stand.abgewiesen } : {}) };
    } else if (pfad === "/intern/status") {
      koerper = {
        datenbank: true,
        flush: true,
        commit: COMMIT,
        telnyxSignaturSchluessel: "ok",
        webhooksAbgewiesen: stand.abgewiesen,
        anrufeUeberHoechstdauer: anrufe,
      };
    } else if (pfad === "/mcp") {
      status = 401;
    } else if (pfad.startsWith("/voice/")) {
      status = 403;
      stand.abgewiesen += 1 + (pfad === "/voice/status" ? fremdeBeiProbe : 0);
    }
    rueckgabe.writeHead(status, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(koerper));
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  return `http://127.0.0.1:${antwort.address().port}`;
}

async function laufen({ vorher = 0, fremdeBeiProbe = 0, anrufe = 0 }) {
  const stagingUrl = await starten({ vorher, fremdeBeiProbe, anrufe });
  const zeilen = [];
  const ergebnis = await staging({
    einstellungen: { stagingUrl, statusToken: STATUS_TOKEN, absichtlichRot: false },
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr: { jetzt: () => 1_700_000_123_000, warten: async () => undefined },
    probeAuth: async () => 0,
  });
  return { ergebnis, warnung: zeilen.filter((z) => z.includes("Frühwarnung")) };
}

test("Nur die eigenen Proben abgewiesen: Staging bleibt grün ohne Frühwarnung", async () => {
  const { ergebnis, warnung } = await laufen({});
  assert.equal(ergebnis, true);
  assert.deepEqual(warnung, []);
});

test("Früher abgewiesene Webhooks zählen nicht: nur der Zuwachs seit dem Stand vor den Proben", async () => {
  const { ergebnis, warnung } = await laufen({ vorher: 3 });
  assert.equal(ergebnis, true);
  assert.deepEqual(warnung, []);
});

test("Ein weiterer abgewiesener Webhook über die eigenen Proben macht den Schritt rot", async () => {
  const { ergebnis, warnung } = await laufen({ vorher: 3, fremdeBeiProbe: 1 });
  assert.equal(ergebnis, false);
  assert.deepEqual(warnung, ["Rot: Frühwarnung, 1 abgewiesene Webhooks über die eigenen Proben, 0 Anrufe über der Höchstdauer"]);
});

test("Ein aktiver Anruf über der Höchstdauer macht den Schritt rot", async () => {
  const { ergebnis, warnung } = await laufen({ anrufe: 1 });
  assert.equal(ergebnis, false);
  assert.deepEqual(warnung, ["Rot: Frühwarnung, 0 abgewiesene Webhooks über die eigenen Proben, 1 Anrufe über der Höchstdauer"]);
});
