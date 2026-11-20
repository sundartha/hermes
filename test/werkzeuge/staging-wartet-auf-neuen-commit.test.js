import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { staging } from "../../tools/deploy-weg/staging.mjs";

const COMMIT = "e2132525" + "a".repeat(32);
const ALT = "784cb330" + "b".repeat(32);
const STATUS_TOKEN = "s".repeat(40);
const PEM = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
const PIN_ZEILE = `ABBRUCH: Ziel-Pin verletzt: faehrt ${ALT.slice(0, 8)}, erwartet ${COMMIT.slice(0, 8)}`;
const TAKT_MS = 20_000;
const FRIST_MS = 180_000;
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function statusAntwort(commits, gesund) {
  let zaehler = 0;
  return () => {
    const commit = commits[Math.min(zaehler, commits.length - 1)];
    zaehler += 1;
    return [200, { datenbank: gesund, flush: true, commit, telnyxSignaturSchluessel: "ok" }];
  };
}

async function laufen({ statusCommits = [COMMIT], gesund = true, authFolge = [0], webhook = 403, pinTakte }) {
  const status = statusAntwort(statusCommits, gesund);
  const antwort = createServer((anfrage, rueckgabe) => {
    let code = 404;
    let koerper = {};
    if (anfrage.url === "/healthz") [code, koerper] = [200, { ok: true, commit: COMMIT }];
    else if (anfrage.url === "/intern/status") [code, koerper] = status();
    else if (anfrage.url === "/mcp") code = 401;
    else if (anfrage.url.startsWith("/voice/")) code = webhook;
    rueckgabe.writeHead(code, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(koerper));
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  const zeilen = [];
  const pausen = [];
  let aufrufe = 0;
  const uhr = { jetzt: () => 1_700_000_000_000, warten: async (ms) => void pausen.push(ms) };
  const ergebnis = await staging({
    einstellungen: {
      stagingUrl: `http://127.0.0.1:${antwort.address().port}`,
      statusToken: STATUS_TOKEN,
      telnyxSchluessel: PEM,
      absichtlichRot: false,
    },
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr,
    ...(pinTakte ? { pinTakte } : {}),
    probeAuth: async ({ ausgabe }) => {
      const exit = authFolge[Math.min(aufrufe, authFolge.length - 1)];
      aufrufe += 1;
      if (exit === "pin") {
        ausgabe.melde("probe_auth_zeile", { zeile: PIN_ZEILE });
        return 2;
      }
      return exit;
    },
  });
  return { ergebnis, zeilen, pausen, aufrufe };
}

test("Auth-Probe sieht erst den alten, dann den neuen Commit: gruen nach einem Takt Wartezeit", async () => {
  const { ergebnis, pausen, zeilen } = await laufen({ authFolge: ["pin", 0] });
  assert.equal(ergebnis, true);
  assert.deepEqual(pausen, [TAKT_MS]);
  assert.ok(zeilen.includes(`Staging meldet noch nicht den Commit ${COMMIT}, neuer Versuch nach dem Takt`));
});

test("Status meldet erst den alten, dann den neuen Commit: gruen nach einem Takt Wartezeit", async () => {
  const { ergebnis, pausen } = await laufen({ statusCommits: [ALT, COMMIT] });
  assert.equal(ergebnis, true);
  assert.deepEqual(pausen, [TAKT_MS]);
});

test("Auth-Probe sieht bis Fristende nur den alten Commit: rot nach drei Minuten mit beiden Commits in der Ausgabe", async () => {
  const { ergebnis, zeilen, pausen, aufrufe } = await laufen({ authFolge: ["pin"] });
  assert.equal(ergebnis, false);
  assert.equal(pausen.reduce((a, b) => a + b, 0), FRIST_MS);
  assert.equal(pausen.length, FRIST_MS / TAKT_MS);
  assert.equal(aufrufe, FRIST_MS / TAKT_MS + 1);
  assert.ok(zeilen.includes(`Probe: ${PIN_ZEILE}`));
});

test("Status meldet bis Fristende nur den alten Commit: rot nach drei Minuten", async () => {
  const { ergebnis, pausen } = await laufen({ statusCommits: [ALT] });
  assert.equal(ergebnis, false);
  assert.equal(pausen.reduce((a, b) => a + b, 0), FRIST_MS);
});

test("Auth-Probe scheitert ohne Ziel-Pin-Meldung: sofort rot ohne Wartezeit", async () => {
  const { ergebnis, pausen, aufrufe } = await laufen({ authFolge: [2] });
  assert.equal(ergebnis, false);
  assert.deepEqual(pausen, []);
  assert.equal(aufrufe, 1);
});

test("Status ungesund mit altem Commit: sofort rot ohne Wartezeit", async () => {
  const { ergebnis, pausen } = await laufen({ statusCommits: [ALT], gesund: false });
  assert.equal(ergebnis, false);
  assert.deepEqual(pausen, []);
});

test("Webhook nicht abgewiesen: sofort rot ohne Wartezeit", async () => {
  const { ergebnis, pausen } = await laufen({ webhook: 200 });
  assert.equal(ergebnis, false);
  assert.deepEqual(pausen, []);
});

test("Die letzte Wartezeit wird auf die Frist gekuerzt", async () => {
  const pinTakte = { taktMs: 50_000, fristMs: 120_000 };
  const { ergebnis, pausen } = await laufen({ authFolge: ["pin"], pinTakte });
  assert.equal(ergebnis, false);
  assert.deepEqual(pausen, [50_000, 50_000, 20_000]);
});

test("Status-Wartemeldung erscheint, solange der alte Commit gemeldet wird", async () => {
  const { zeilen } = await laufen({ statusCommits: [ALT, COMMIT] });
  assert.ok(zeilen.includes(`Staging meldet noch nicht den Commit ${COMMIT}, neuer Versuch nach dem Takt`));
});
