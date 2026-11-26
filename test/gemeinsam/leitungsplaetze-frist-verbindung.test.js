import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";

import { LEITUNGSPLATZ_DB_FRIST_MS } from "../../src/begriffe/speicher.ts";
import { mitGestartetemHermes, pgStartUmgebung } from "./pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const PUFFER_MS = 1_500;
const ANFRAGE = Object.freeze({ tenantId: "tenant_frist", weg: "elevenlabs", hoechstzahlKunde: 2 });
const BELEGEN = Object.freeze({ callId: "call_frist", tenantId: "tenant_frist", weg: "elevenlabs", maxDauerS: 60, hoechstzahlKunde: 2 });
const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const KIND_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
await speicher.oeffneSpeicher();
await speicher.pruefeVerbindung();
process.stdout.write("bereit\\n");
const [aktion, anfrage] = [process.argv[1], JSON.parse(process.argv[2])];
await new Promise((weiter) => process.stdin.once("data", weiter));
if (process.argv[3] === "verworfen") await speicher.pruefeVerbindung().catch(() => {});
const frei = [];
if (process.argv[3] === "erschoepft") {
  const belegt = [1, 2, 3, 4, 5, 6].map((routine) => new Promise((belegtMeldung) => {
    speicher.mitStartSperre(routine, () => new Promise((loesen) => { frei.push(loesen); belegtMeldung(); }));
  }));
  await Promise.all(belegt);
  setTimeout(() => frei[0](), ${LEITUNGSPLATZ_DB_FRIST_MS + 1000});
}
const beginn = Date.now();
const ergebnis = await speicher.leitungsplaetze[aktion](anfrage);
const dauerMs = Date.now() - beginn;
if (process.argv[3] === "erschoepft") {
  await new Promise((weiter) => setTimeout(weiter, 2000));
  const belegung = await speicher.leitungsplaetze.belegung();
  process.stdout.write(JSON.stringify({ ergebnis, dauerMs, belegung }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ ergebnis, dauerMs }) + "\\n");
process.exit(0);
`;

async function starteWeiche(ziel) {
  const sockets = new Set();
  const zustand = { eingefroren: false };
  const server = net.createServer((vorn) => {
    sockets.add(vorn);
    if (zustand.eingefroren) return;
    const hinten = net.connect(Number(ziel.port), ziel.hostname);
    sockets.add(hinten);
    const leite = (von, nach) => von.on("data", (daten) => !zustand.eingefroren && nach.write(daten));
    leite(vorn, hinten);
    leite(hinten, vorn);
    for (const socket of [vorn, hinten]) socket.on("error", () => socket.destroy());
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return {
    port: server.address().port,
    einfrieren: () => {
      zustand.eingefroren = true;
    },
    abreissen: () => sockets.forEach((socket) => socket.destroy()),
    schliessen: () => {
      sockets.forEach((socket) => socket.destroy());
      server.close();
    },
  };
}

async function frageBeiEingefrorenerDatenbank(t, { aktion, anfrage, abreissen }) {
  const db = await echteDatenbankMitRolle(t);
  await mitGestartetemHermes(db.adresse, {}, async () => {});
  const ziel = new URL(db.adresse);
  const weiche = await starteWeiche(ziel);
  t.after(() => weiche.schliessen());
  const ueber = new URL(db.adresse);
  ueber.hostname = "127.0.0.1";
  ueber.port = String(weiche.port);
  const kind = spawn(process.execPath, ["--input-type=module", "-e", KIND_SKRIPT, aktion, JSON.stringify(anfrage), abreissen === "erschoepft" ? "erschoepft" : abreissen ? "verworfen" : "gehalten"], {
    env: { ...process.env, ...pgStartUmgebung(ueber.href) },
    stdio: ["pipe", "pipe", "inherit"],
  });
  t.after(() => kind.kill());
  let ausgabe = "";
  const zeile = (muster) =>
    new Promise((fertig) => {
      const pruefe = () => {
        const treffer = ausgabe.split("\n").find((eintrag) => muster.test(eintrag));
        if (treffer) fertig(treffer);
      };
      kind.stdout.on("data", (daten) => {
        ausgabe += daten;
        pruefe();
      });
      pruefe();
    });
  await zeile(/^bereit$/);
  if (abreissen !== "erschoepft") weiche.einfrieren();
  if (abreissen === true) weiche.abreissen();
  kind.stdin.write("los\n");
  return JSON.parse(await zeile(/^\{/));
}

for (const [name, abreissen] of [
  ["BEGIN haengt auf einer vorhandenen Verbindung", false],
  ["Verbindungsaufbau antwortet nicht", true],
]) {
  test(`${name}: Pruefen lehnt nach der Frist ab, nicht erst nach 10 Sekunden`, { timeout: ZEITGRENZE_MS }, async (t) => {
    if (!postgresVorhanden()) return;
    const { ergebnis, dauerMs } = await frageBeiEingefrorenerDatenbank(t, { aktion: "pruefenAusgehend", anfrage: ANFRAGE, abreissen });
    assert.equal(ergebnis, "anbieter_voll");
    assert.ok(dauerMs >= LEITUNGSPLATZ_DB_FRIST_MS - 500, `wartet bis zur Frist: ${dauerMs} ms`);
    assert.ok(dauerMs < LEITUNGSPLATZ_DB_FRIST_MS + PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
  });

  test(`${name}: Belegen liefert anbieter_voll nach der Frist`, { timeout: ZEITGRENZE_MS }, async (t) => {
    if (!postgresVorhanden()) return;
    const { ergebnis, dauerMs } = await frageBeiEingefrorenerDatenbank(t, { aktion: "belegenAusgehend", anfrage: BELEGEN, abreissen });
    assert.deepEqual(ergebnis, { entscheidung: "anbieter_voll" });
    assert.ok(dauerMs < LEITUNGSPLATZ_DB_FRIST_MS + PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
  });
}

test("Pool erschoepft, Verbindung wird nach der Frist frei: anbieter_voll und kein leitungsplatz-Eintrag", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  const { ergebnis, dauerMs, belegung } = await frageBeiEingefrorenerDatenbank(t, { aktion: "belegenAusgehend", anfrage: BELEGEN, abreissen: "erschoepft" });
  assert.deepEqual(ergebnis, { entscheidung: "anbieter_voll" });
  assert.ok(dauerMs >= LEITUNGSPLATZ_DB_FRIST_MS - 500, `wartet bis zur Frist: ${dauerMs} ms`);
  assert.ok(dauerMs < LEITUNGSPLATZ_DB_FRIST_MS + PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
  assert.deepEqual(belegung.map((eintrag) => eintrag.belegt), belegung.map(() => 0));
});
